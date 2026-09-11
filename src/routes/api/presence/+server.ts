import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { onlineUsers, touchPresence } from "$lib/server/activity.js";

/**
 * GET  /api/presence —— 当前在线用户（需登录）。
 * POST /api/presence —— 心跳：刷新当前会话 last_seen，返回在线快照。
 *
 * 前端每 60s 调一次 POST，保证「多用户同时在线」的判定实时且不依赖页面浏览。
 */
export function GET(event: RequestEvent) {
	const user = verifyToken(event.cookies.get("admin_token"));
	if (!user) return json({ error: "未登录" }, { status: 401 });
	const online = onlineUsers();
	return json({ online, count: online.length });
}

export function POST(event: RequestEvent) {
	const token = event.cookies.get("admin_token");
	const user = verifyToken(token);
	if (!user) return json({ error: "未登录" }, { status: 401 });
	touchPresence(token);
	const online = onlineUsers();
	return json({ ok: true, online, count: online.length });
}
