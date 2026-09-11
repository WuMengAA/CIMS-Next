import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import type { RequestEvent } from "@sveltejs/kit";
import http from "node:http";
import { verifyToken } from "$lib/server/auth.js";
import { can, type Action } from "$lib/permissions.js";

// 集控面板（/admin/console 内嵌）对 CIMS 的服务端代理。
// 浏览器只与同源网站通信；CIMS 地址与令牌仅在服务端配置，绝不下发前端。
// 仅放行集控所需路径，防 SSRF / 越权。
//
// ⚠️ 鉴权（曾经缺失，属高危）：
// 本代理持有一个**服务端特权 CIMS 会话令牌**（CIMS_ADMIN_EMAIL/PASSWORD 换取），
// 因此每一次请求都必须先确认调用者是已登录且具备集控权限的站点用户。
// hooks.server.ts 只守 /admin 页面路由，/api 在跳过列表里 —— 也就是说
// 这个文件里的鉴权是唯一一道门，漏了就等于把「读全部账号/设备 + 下发重启指令」
// 的能力开放给任何能访问本站的人。

const CIMS = (env.CIMS_MANAGEMENT_URL ?? "http://127.0.0.1:8097").replace(/\/$/, "");
// CIMS 管理接口用「会话令牌」鉴权（Redis session:{token}），需先用管理员账号登录换取。
const ADMIN_EMAIL = env.CIMS_ADMIN_EMAIL ?? "techrep01@test.com";
const ADMIN_PASSWORD = env.CIMS_ADMIN_PASSWORD ?? "TestPass123456";
// CIMS 客户端应用（教室端配置拉取）端口：课表/组件配置的真实读取点。
// 它挂载在 prefix="/api" 且 TenantMiddleware 要求 Host 头为 <slug>.<BASE_DOMAIN>，否则 403。
const CLIENT_URL = (env.CIMS_CLIENT_URL ?? "http://127.0.0.1:8096").replace(/\/$/, "");
const BASE_DOMAIN = env.CIMS_BASE_DOMAIN ?? "localhost";
// 允许的路径：账户/指令/资源（management）、登录、以及客户端配置拉取（含带 /api 前缀的写法）。
const ALLOW = [/^\/account\//, /^\/user\/auth/, /^\/v1\/client\//, /^\/api\/v1\/client\//];

/**
 * 按「方法 + 路径 + 载荷」判定所需权限，力求最小必要：
 *  - 读（GET）                     -> viewConsole
 *  - /user/auth（换取令牌，非变更） -> viewConsole
 *  - 设备指令 command/*             -> controlDevice
 *  - 带 stelarith_task 的通知       -> remoteControl（远程屏幕控制，更敏感）
 *  - 其余写（资源 write 等）         -> manageDevices
 */
function requiredAction(rel: string, method: string, body: string | undefined): Action {
	if (method === "GET" || rel === "/user/auth") return "viewConsole";
	if (body && body.includes("stelarith_task")) return "remoteControl";
	if (/^\/account\/[^/]+\/client\/[^/]+\/command\//.test(rel)) return "controlDevice";
	return "manageDevices";
}

// 进程内缓存的 CIMS 会话令牌；过期/失效时自动重新登录换取。
let sessionToken: string | null = null;
let renewing = false;

async function acquireToken(): Promise<string | null> {
	if (sessionToken) return sessionToken;
	if (renewing) return null;
	renewing = true;
	try {
		const r = await fetch(`${CIMS}/user/auth`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
		});
		if (r.ok) {
			const data = (await r.json()) as { token?: string };
			sessionToken = data.token ?? null;
		}
	} catch {
		sessionToken = null;
	} finally {
		renewing = false;
	}
	return sessionToken;
}

// 缓存首个 CIMS 账户 slug（用于客户端应用 TenantMiddleware 的 Host 头 <slug>.<BASE_DOMAIN>）。
// 本代理持有管理令牌，能读 /account/list；slug 仅用于拼 Host 头，不下发前端。
let accountSlug: string | null = null;
async function acquireSlug(token: string): Promise<string | null> {
	if (accountSlug) return accountSlug;
	try {
		const r = await fetch(`${CIMS}/account/list`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (r.ok) {
			const list = (await r.json()) as Array<{ slug?: string }>;
			if (Array.isArray(list) && list.length) accountSlug = list[0].slug ?? null;
		}
	} catch { accountSlug = null; }
	return accountSlug;
}

async function proxyOnce(event: RequestEvent, token: string, body: string | undefined, target: string, extraHeaders: Record<string, string> = {}) {
	const method = event.request.method;
	const upstream = await fetch(target, {
		method,
		headers: {
			"content-type": event.request.headers.get("content-type") ?? "application/json",
			// 始终用服务端会话令牌，忽略前端可能带入的凭据
			Authorization: `Bearer ${token}`,
			...extraHeaders,
		},
		body,
	});
	const text = await upstream.text();
	return new Response(text, {
		status: upstream.status,
		headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
	});
}

// 客户端配置拉取专用代理：必须用 node:http（而非 fetch）才能覆盖 Host 头，
// 否则 TenantMiddleware 识别不到租户（undici 会忽略手动 Host）。
// client 应用的资源端点会 302 到 /get?token=... 再回 200 正文，这里自动跟随。
function proxyClient(path: string, hostHeader: string): Promise<Response> {
	const u = new URL(CLIENT_URL);
	return new Promise((resolve, reject) => {
		const attempt = (p: string, hops: number) => {
			const req = http.request(
				{
					host: u.hostname,
					port: u.port ? Number(u.port) : 80,
					path: p,
					method: "GET",
					headers: {
						"content-type": "application/json",
						accept: "application/json",
						Host: hostHeader,
					},
				},
				(up) => {
					const loc = up.headers.location;
					if (up.statusCode && up.statusCode >= 300 && up.statusCode < 400 && loc && hops < 5) {
						const np = loc.startsWith("http")
							? new URL(loc).pathname + (new URL(loc).search ?? "")
							: loc;
						up.resume();
						attempt(np, hops + 1);
						return;
					}
					let data = "";
					up.setEncoding("utf8");
					up.on("data", (c) => (data += c));
					up.on("end", () =>
						resolve(
							new Response(data, {
								status: up.statusCode ?? 200,
								headers: { "content-type": up.headers["content-type"] ?? "application/json" },
							})
						)
					);
				}
			);
			req.on("error", reject);
			req.end();
		};
		attempt(path, 0);
	});
}

async function forward(event: RequestEvent) {
	const rel = "/" + (event.params.cims ?? "");
	const method = event.request.method;
	// 先读一次体：既用于权限判定（是否远程控制任务），也用于转发。
	const body = method === "GET" || method === "DELETE" ? undefined : await event.request.text();

	// ---- 鉴权（必须在放行路径检查之前，避免匿名用户探测可用路径）----
	const u = verifyToken(event.cookies.get("admin_token"));
	if (!u) return json({ error: "请先登录" }, { status: 401 });
	const need = requiredAction(rel, method, body);
	if (!can(u.role, "viewConsole") || !can(u.role, need)) {
		return json({ error: "无权限" }, { status: 403 });
	}

	if (!ALLOW.some((re) => re.test(rel))) {
		return json({ error: "forbidden path" }, { status: 403 });
	}

	const token = await acquireToken();
	if (!token) {
		return json({ error: "cims auth unavailable" }, { status: 502 });
	}

	// 客户端配置拉取（课表/组件）：转发到 client 应用（8096）并补 /api 前缀，
	// 且必须带 TenantMiddleware 要求的 Host 头 <slug>.<BASE_DOMAIN>，否则 403。
	// 客户端配置拉取（课表/组件）：转发到 client 应用（8096）并补 /api 前缀，
	// 且必须带 TenantMiddleware 要求的 Host 头 <slug>.<BASE_DOMAIN>，否则 403。
	// ⚠️ 关键：必须用 node:http 直接发请求——undici(fetch) 会忽略手动设置的 Host 头，
	// 导致上游收到 Host: 127.0.0.1:8096 而 403「未识别出租户」。
	if (/^\/(api\/)?v1\/client\//.test(rel)) {
		const clientRel = rel.startsWith("/api/v1/client/") ? rel.slice(4) : rel; // 归一为 /v1/client/...
		const path = "/api" + clientRel + (event.url.search ?? "");
		const slug = await acquireSlug(token);
		const hostHeader = slug ? `${slug}.${BASE_DOMAIN}` : BASE_DOMAIN;
		return proxyClient(path, hostHeader);
	}

	const target = CIMS + rel + (event.url.search ?? "");
	let res = await proxyOnce(event, token, body, target);
	// 令牌失效：清空缓存、重新登录并仅重试一次
	if (res.status === 401) {
		sessionToken = null;
		accountSlug = null;
		const t2 = await acquireToken();
		if (t2) res = await proxyOnce(event, t2, body, target);
	}
	return res;
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const DELETE = forward;
