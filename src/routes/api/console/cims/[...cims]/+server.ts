import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import type { RequestEvent } from "@sveltejs/kit";

// 集控面板（/admin/console 内嵌）对 CIMS 的服务端代理。
// 浏览器只与同源网站通信；CIMS 地址与令牌仅在服务端（.env）配置，绝不下发前端。
// 仅放行集控所需路径，防 SSRF / 越权。

const CIMS = (env.CIMS_MANAGEMENT_URL ?? "http://127.0.0.1:8081").replace(/\/$/, "");
const TOKEN = env.CIMS_TOKEN ?? "";
const ALLOW = [/^\/account\//, /^\/user\/auth/, /^\/v1\/client\//];

async function forward(event: RequestEvent) {
	const rel = "/" + (event.params.cims ?? "");
	if (!ALLOW.some((re) => re.test(rel))) {
		return json({ error: "forbidden path" }, { status: 403 });
	}
	const target = CIMS + rel + (event.url.search ?? "");
	const method = event.request.method;
	const body = method === "GET" || method === "DELETE" ? undefined : await event.request.text();
	const upstream = await fetch(target, {
		method,
		headers: {
			"Content-Type": event.request.headers.get("content-type") ?? "application/json",
			// 始终用服务端令牌，忽略前端可能带入的凭据
			Authorization: `Bearer ${TOKEN}`,
		},
		body,
	});
	const text = await upstream.text();
	return new Response(text, {
		status: upstream.status,
		headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
	});
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const DELETE = forward;
