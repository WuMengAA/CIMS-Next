import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import type { RequestEvent } from "@sveltejs/kit";
import http from "node:http";
import { verifyToken } from "$lib/server/auth.js";
import { can, userCan, canDevice, roleManagementTier, type DeviceTier, type Role } from "$lib/permissions.js";
import { classScopeOf, scopeCovers, listBindings } from "$lib/server/class-scope.js";
import { fetchDeviceClassMap } from "$lib/server/cims-client.js";

// ── 分级过滤（2026-09-21 修复：不同权限看见不该看的）─────────────────────
// 代理以「服务端特权 CIMS 令牌」转发，8097 侧分辨不出「谁在问」——所以过滤只能在
// 这一层做，用网站会话里解出的角色/班级信息把响应收敛到调用者能管的范围：
//   · 校级（owner/admin/editor）            → 原样全量；
//   · 年级级 / 班级级（teacher/moderator/…）→ **设备**只保留「班级名能对上我绑定班级」
//     的班，未绑班设备一律不给。
// 班级**目录**（/class/list，就「3班/2025届3班」这类名字）保持全量可见：
// ① 它是校内公开目录，不敏感；② 绑定页靠它才能「还没绑定时看到全部可选班级」
// （若过滤，新老师一进来就是空下拉，死锁）。
// ⚠️ 过渡说明：CIMS 班级实体尚无可靠的年级字段（真实 12 班 graduation_year 全空），
// 年级级暂时与班级级同口径（宁严勿泄）；等班级实体补上年级字段后放开到「同年级」。
// 原则一句话：**确定不了归属的，就不给看** —— 泄漏比误伤难修复得多。
function scopeDigits(s: unknown): string {
	const m = String(s ?? "").match(/\d+/g);
	return m ? m.map((d) => String(Number(d))).join("") : "";
}
function classMatches(c: Record<string, unknown>, ownDigits: string): boolean {
	if (!ownDigits) return false;
	const cands = [c.name, c.code, c.display_code, c.displayCode, c.class_id]
		.map((v) => scopeDigits(v))
		.filter(Boolean);
	return cands.some((d) => d === ownDigits);
}
function applyScopeFilter(
	u: { role?: string | null; className?: string | null; id?: number | null },
	rel: string,
	payload: unknown
): unknown {
	// ⚠️ 设备三关铁律（#249 → v2 2026-09-25 收紧）：能看设备（watch 档）的只剩
	// 站长/班主任（电教委员 v2 只剩传文件，watch 也收回）。非 watch 档的设备列表
	// 接口**直接返回空数组** —— 不是前端藏，是接口就没有（本机截图=敏感内容）。
	if (!canDevice((u.role ?? null) as never, "watch")) {
		if (rel === "/class/device-status") return { devices: [], fresh_seconds: 90 };
		if (rel === "/class/device-map") return { devices: {}, classes: [] };
		// 其余 /class/ 下的非设备数据（如 /class/list 班级目录）原样放行，
		// 绑定页依赖它给未绑定用户候选班。
		return payload;
	}
	const tier = roleManagementTier((u.role ?? null) as never) ?? "class";
	if (tier === "school") return payload; // 校级全量
	// 班级目录（/class/list）保持全量：班级名不敏感，且绑定页依赖它给未绑定用户候选。
	if (rel === "/class/list") return payload;

	// ── v2：范围权威来源 = user_class_bindings（真实 class_id）──────────────
	// 没绑定的 homeroom/teacher/techrep = 空范围 = 设备一条不给。
	// 迁移宽容：绑定表为空但 users.class_name 带数字时，退回旧数字启发式，
	// 避免上线瞬间把还没来得及重新绑定的存量账号全部打成"看不见设备"。
	const scope = classScopeOf((u.role ?? null) as Role, u.id ?? null);
	const ownIds: string[] = scope === "*" ? [] : scope;
	const ownDigits = ownIds.length === 0 ? scopeDigits(u.className) : "";
	const hitByBinding = (c: Record<string, unknown>): boolean => {
		const cid = String(c.class_id ?? "");
		if (cid && scopeCovers(ownIds, cid)) return true;
		// 名称兜底：绑定表存了 class_name，而列表项只有名字没有 id 的形态
		const name = String(c.name ?? "");
		if (name && listBindings(u.id ?? 0).some((b) => b.class_name && b.class_name === name)) return true;
		return false;
	};
	const hitByDigits = (c: Record<string, unknown>): boolean => classMatches(c, ownDigits);
	const hit = (c: Record<string, unknown>): boolean =>
		ownIds.length > 0 ? hitByBinding(c) : ownDigits ? hitByDigits(c) : false;

	if (rel === "/class/device-status" && payload && typeof payload === "object") {
		const p = payload as { devices?: unknown[] };
		if (Array.isArray(p.devices)) {
			p.devices = p.devices.filter((d) => {
				const cid = String((d as Record<string, unknown>).class_id ?? "");
				return !!cid && hit({ class_id: cid });
			});
		}
		return payload;
	}
	if (rel === "/class/device-map" && payload && typeof payload === "object") {
		const p = payload as { devices?: Record<string, unknown>; classes?: unknown[] };
		if (p.devices && typeof p.devices === "object") {
			for (const k of Object.keys(p.devices)) {
				if (!hit({ class_id: p.devices[k] } as Record<string, unknown>)) delete p.devices[k];
			}
		}
		if (Array.isArray(p.classes)) {
			p.classes = p.classes.filter((c) => hit(c as Record<string, unknown>));
		}
		return payload;
	}
	return payload;
}

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
// 凭据只从环境变量读取，不留源码兜底值——写死会把服务账号带进公开仓库。
const ADMIN_EMAIL = env.CIMS_ADMIN_EMAIL ?? "";
const ADMIN_PASSWORD = env.CIMS_ADMIN_PASSWORD ?? "";
const CREDS_READY = Boolean(ADMIN_EMAIL && ADMIN_PASSWORD);
// CIMS 客户端应用（教室端配置拉取）端口：课表/组件配置的真实读取点。
// 它挂载在 prefix="/api" 且 TenantMiddleware 要求 Host 头为 <slug>.<BASE_DOMAIN>，否则 403。
const CLIENT_URL = (env.CIMS_CLIENT_URL ?? "http://127.0.0.1:8096").replace(/\/$/, "");
const BASE_DOMAIN = env.CIMS_BASE_DOMAIN ?? "localhost";
// 集控面板**目标租户 slug**（客户端配置拉取用的 Host 头 <slug>.<BASE_DOMAIN>）。
// 显式指定后，面板拉的课表/组件**恒属于该租户**，不再受 /account/list 的 `list[0]`
// 顺序影响（那是登录用户有权限账户的无序列表，多租户时会让面板"串租户"——
// 永远读第一个账户的资源，与当前设备/班级的真实归属无关）。
// 留空则回退到旧行为（取 list[0].slug），以兼容单租户部署的既有配置。
const TARGET_SLUG = (env.CONSOLE_TARGET_SLUG ?? "").trim().toLowerCase();
// 允许的路径：账户/指令/资源（management）、登录、班级（设备归属与切班）、
// 以及客户端配置拉取（含带 /api 前缀的写法）。
const ALLOW = [
	/^\/account\//,
	/^\/user\/auth/,
	/^\/class\//,
	/^\/scheduled-broadcast\//,
	/^\/v1\/client\//,
	/^\/api\/v1\/client\//
];

/**
 * 按「方法 + 路径 + 载荷」判定所需**设备权限档位**，力求最小必要：
 *  - 读（GET）                     -> watch（仅需进入面板）
 *  - /user/auth（换取令牌，非变更） -> watch
 *  - 设备指令 command/*             -> control
 *  - 带 stelarith_task 的通知       -> remote（远程屏幕控制，更敏感）
 *  - 其余写（资源 write 等）         -> manage
 *
 * 返回 null 表示这是纯读请求，只校验 viewConsole（等级轴）。
 */
function requiredTier(rel: string, method: string, body: string | undefined): DeviceTier | null {
	// ---- 审核队列：是「读」，但读的是全校待审班级（含他人提交的班号与属主）----
	// 比普通只读敏感，因此**刻意放在下面的 GET→watch 放宽之前**，显式要求 manage。
	// （后端 list_pending_classes 另有 403 兜底；这里是第二道门。）
	if (/^\/class\/pending$/.test(rel)) return "manage";

	// ---- 星集控桌面端「本机被控」自报 ----
	// POST /v1/client/{uid}/status（上报本机在线状态）与 POST .../command/ack（回报指令执行结果）
	// 是**设备谈自己**：报自己的状态、回自己的执令结果。这两条若不特判会落到文件末尾的
	// manage 兜底，于是只有站长能把自己标成被控 —— 而真正需要这个功能的是
	// 老师的办公机、电教委员的笔记本（他们都是 control 档）。
	// 因此放宽到 control：与「给别人下发设备指令」同档，不涉及 remote/manage 的语义。
	// ⚠️ 刻意只放行 POST：GET 读设备状态仍走下面的 watch 放宽，
	// 否则只看不动的审核员/游客会连面板都读不出设备状态（那是另一码事）。
	if (
		method === "POST" &&
		/^\/?(api\/)?v1\/client\/[^/]+\/(status|command\/ack)$/.test(rel)
	) {
		return "control";
	}

	// ---- 自助切班：互换/单切申请的创建、取消、回退 ----
	// 是班主任/电教委员的日常操办（不是站长专属），按 control 档而非 manage 兜底：
	// 与「下发设备指令」同档即可 —— 换课表方案属于设备控制动作，不涉及 manage 语义。
	// ⚠️ 审批（approve/reject）与全局开关（config）是 manage 语义：审批 = 替他人
	// 放行一次班级级变更，config = 改全校审批策略，都比普通换班更敏感，
	// 不能让 teacher/homeroom 的 control 档拿到（2026-09-24 接力棒修正）。
	// GET 一律走下方 watch 放宽（列表/详情是只读）；config 的 GET 也归 manage：
	// 开关值影响全校流程，读它只给 manage 档（与 class/pending 的「读但敏感」同款）。
	if (/^\/class\/swap\/config$/.test(rel)) return "manage";
	if (method !== "GET" && /^\/class\/swap($|\/)/.test(rel)) {
		if (/\/approve$/.test(rel) || /\/reject$/.test(rel)) return "manage";
		return "control";
	}

	if (method === "GET" || rel === "/user/auth") return null;
	if (body && body.includes("stelarith_task")) return "remote";
	// ---- 班级（#182 文件夹式：建班 / 审核 / 预览 / 切班）----
	// 建班：电教委员、老师也必须能**登记自己的班**（后端落 pending 待审，不是直接生效）。
	// 若沿用下面的 manage 兜底，就只有站长建得了班 —— 于是后端精心设计的
	// 「普通用户建 → 待审」这条路永远走不到，审核队列永远是空的。
	if (/^\/class\/create$/.test(rel)) return "control";
	// 批准/驳回一个班 = 给它开「绑设备 + 下发」的口子 → manage。
	if (/^\/class\/[^/]+\/review$/.test(rel)) return "manage";
	// 班级预览图是本班自己的门面，随班维护 → control。
	// （必须排在 activate 之前无差别，只因两者都是 /class/{id}/<动作> 形态。）
	if (/^\/class\/[^/]+\/preview$/.test(rel)) return "control";
	// 远程切班：电教委员的日常动作（把本班大屏切到某份课表），control 档即可。
	// 单独拎出来是因为它落在 /class/ 下，若不特判会被下面的 manage 兜底拦掉。
	if (/^\/class\/[^/]+\/activate$/.test(rel)) return "control";
	// 班级增删改、设备划班/移班、班级资源写：影响面超出单个班 → manage。
	if (/^\/class\//.test(rel)) return "manage";
	// 定时广播：立即触发相当于一次定向广播（control）；配置增删改影响面更大（manage）。
	if (/^\/scheduled-broadcast\/[^/]+\/fire-now$/.test(rel)) return "control";
	if (/^\/scheduled-broadcast\//.test(rel)) return "manage";
	if (/^\/account\/[^/]+\/client\/[^/]+\/command\//.test(rel)) return "control";
	return "manage";
}

// 进程内缓存的 CIMS 会话令牌；过期/失效时自动重新登录换取。
let sessionToken: string | null = null;
let renewing = false;

async function acquireToken(): Promise<string | null> {
	if (sessionToken) return sessionToken;
	if (renewing) return null;
	if (!CREDS_READY) {
		console.warn("[console] CIMS_ADMIN_EMAIL / CIMS_ADMIN_PASSWORD 未配置，集控代理不可用");
		return null;
	}
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
// 首选显式配置的 CONSOLE_TARGET_SLUG（多租户下精确指定面板看哪个租户）；
// 未配置时回退：本代理持有管理令牌，读 /account/list 取 list[0].slug 兼容单租户。
// slug 仅用于拼 Host 头，不下发前端。
let accountSlug: string | null = null;
async function acquireSlug(token: string): Promise<string | null> {
	if (TARGET_SLUG) return TARGET_SLUG;
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

// 客户端应用（8096）专用代理：必须用 node:http（而非 fetch）才能覆盖 Host 头，
// 否则 TenantMiddleware 识别不到租户（undici 会忽略手动 Host）。
//
// ⚠️ 必须**保留原方法与原请求体**（曾经把 method 写死成 GET）：
// 这条分支最早只为「拉课表/组件」服务，全是读，所以写死 GET 一直没暴露。
// 一旦有写请求经它下发（例如被控桌面端 POST /status 与 /command/ack），
// 写会被**静默降级成读** —— 表现是 POST 返回 200 但什么都没发生、
// 或 ack 报 405 Method Not Allowed，极难从现象反推原因。
// client 应用的资源端点会 302 到 /get?token=... 再回 200 正文，这里自动跟随；
// 跟随之后的语义按浏览器习惯降级为 GET 且不再带体。
function proxyClient(
	method: string,
	path: string,
	hostHeader: string,
	body?: string
): Promise<Response> {
	const u = new URL(CLIENT_URL);
	return new Promise((resolve, reject) => {
		const attempt = (p: string, hops: number, m: string, b: string | undefined) => {
			const headers: Record<string, string | number> = {
				"content-type": "application/json",
				accept: "application/json",
				Host: hostHeader,
			};
			// 显式给 content-length：避免退化成 chunked，某些上游对 JSON body 不接受
			if (b !== undefined) headers["content-length"] = Buffer.byteLength(b);
			const req = http.request(
				{
					host: u.hostname,
					port: u.port ? Number(u.port) : 80,
					path: p,
					method: m,
					headers,
				},
				(up) => {
					const loc = up.headers.location;
					if (up.statusCode && up.statusCode >= 300 && up.statusCode < 400 && loc && hops < 5) {
						const np = loc.startsWith("http")
							? new URL(loc).pathname + (new URL(loc).search ?? "")
							: loc;
						up.resume();
						attempt(np, hops + 1, "GET", undefined);
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
			if (b !== undefined) req.write(b);
			req.end();
		};
		attempt(path, 0, method, body);
	});
}

async function forward(event: RequestEvent) {
	const rel = "/" + (event.params.cims ?? "");
	const method = event.request.method;
	// 先读一次体：既用于权限判定（是否远程控制任务），也用于转发。
	const body = method === "GET" || method === "DELETE" ? undefined : await event.request.text();

	// ---- 鉴权（必须在放行路径检查之前，避免匿名用户探测可用路径）----
	// 优先用 admin_token Cookie（网页面板），其次接受 Bearer 头（桌面端 OAuth 网站令牌）。
	const cookieToken = event.cookies.get("admin_token");
	let u = cookieToken ? verifyToken(cookieToken) : null;
	if (!u) {
		const authH = event.request.headers.get("authorization") ?? "";
		if (authH.toLowerCase().startsWith("bearer ")) {
			u = verifyToken(authH.slice(7).trim());
		}
	}
	if (!u) return json({ error: "请先登录" }, { status: 401 });
	// 等级轴：进得了集控面板（L1+）。设备轴：写操作另需对应档位。
	if (!userCan(u, "viewConsole")) {
		return json({ error: "无权限" }, { status: 403 });
	}
	const tier = requiredTier(rel, method, body);
	if (tier && !canDevice(u.role, tier)) {
		return json({ error: "无权限" }, { status: 403 });
	}

	// ── v2 班级范围强制（写路径）────────────────────────────────────────────
	// 粗档（control/remote）只回答「能不能发指令」，不回答「能对谁发」——
	// 旧实现里班级账号可以把 shutdown 发给全校任何一台设备，这是范围维度的洞。
	const scope = classScopeOf((u.role ?? null) as Role, u.id ?? null);

	// ① 危险动作收权：shutdown 只归学校管理员（v2 矩阵：关机一格只有站长有勾）。
	if (scope !== "*" && body && /"action"\s*:\s*"(shutdown|reboot)"/.test(body)) {
		return json({ error: "关机/重启只允许学校管理员操作" }, { status: 403 });
	}

	// ② 指令目标范围：给某台设备发指令前，先解析它属于哪个班。
	//    解析不到归属 = 确定不了 = 不放行（宁严勿泄，与列表过滤同一原则）。
	//    ⚠️ /v1/client/{uid}/status|ack 是设备自报（本机被控回执），不在拦截之列。
	const cmdTarget = method === "POST" ? rel.match(/^\/account\/[^/]+\/client\/([^/]+)\/command\//) : null;
	if (cmdTarget && scope !== "*") {
		const targetUid = decodeURIComponent(cmdTarget[1]).toLowerCase();
		const cid = await (async () => {
			const m = await fetchDeviceClassMap();
			return m?.uidToClass.get(targetUid) ?? null;
		})();
		if (!cid || !scopeCovers(scope, cid)) {
			return json({ error: "目标设备不在你的班级范围内" }, { status: 403 });
		}
	}

	// ③ 班级级写操作（切课表/预览图）同样过范围关。
	const clsTarget = method !== "GET" ? rel.match(/^\/class\/([^/]+)\/(activate|preview)$/) : null;
	if (clsTarget && scope !== "*" && !scopeCovers(scope, decodeURIComponent(clsTarget[1]))) {
		return json({ error: "目标班级不在你的绑定范围内" }, { status: 403 });
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
		return proxyClient(method, path, hostHeader, body);
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
	// 分级过滤（2026-09-21）：设备/班级列表收敛到调用者可管范围，堵「看全校」泄漏。
	// ⚠️ 只要 body 是合法 JSON，就**一律以过滤/序列化后的结果返回**——不能靠
	// 「引用是否变化」判断（applyScopeFilter 会原地改对象后返回同一引用，比较恒等
	// 会把过滤结果当成"没变化"，退回原始文本，过滤等于白做）。
	if (res.status === 200 && method === "GET") {
		const raw = await res.text();
		let payload: unknown = null;
		try { payload = JSON.parse(raw); } catch { /* 非 JSON 不处理 */ }
		if (payload !== null) {
			return json(applyScopeFilter(u, rel, payload));
		}
		res = new Response(raw, {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}
	return res;
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const DELETE = forward;
