import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { verifyToken, getUser, adminUpdateUser, deleteUser, revokeSessions } from "$lib/server/auth.js";
import { listUsersOverview, listActivities, onlineUsers, recordActivity } from "$lib/server/activity.js";
import { can } from "$lib/permissions.js";
import type { Role } from "$lib/permissions.js";

/**
 * 多用户资源端点（需 viewAdmin / manageUsers）。
 *
 * GET  /api/users                  —— 用户总览（含在线态 / 会话数 / 活动数）
 * GET  /api/users?username=xxx     —— 单用户详情 + 其近期活动
 * POST /api/users { action }       —— update | delete | revoke_sessions
 */
export function GET(event: RequestEvent) {
	const { url, cookies } = event;
	const me = verifyToken(cookies.get("admin_token"));
	if (!me) return json({ error: "未登录" }, { status: 401 });
	if (!can(me.role, "viewAdmin")) return json({ error: "无权限" }, { status: 403 });

	const username = url.searchParams.get("username");
	if (username) {
		const u = getUser(username);
		if (!u) return json({ error: "用户不存在" }, { status: 404 });
		const { items } = listActivities({ username, limit: 30 });
		const overview = listUsersOverview().find((o) => o.username === username) || null;
		return json({
			user: {
				username: u.username,
				displayName: u.displayName,
				email: u.email,
				avatar: u.avatar,
				bio: u.bio,
				role: u.role,
				status: u.status,
				createdAt: u.createdAt,
				lastLoginAt: u.lastLoginAt,
				loginCount: u.loginCount
			},
			overview,
			activities: items
		});
	}

	return json({ users: listUsersOverview(), online: onlineUsers(), current: me.username });
}

export async function POST(event: RequestEvent) {
	const { request, cookies } = event;
	const me = verifyToken(cookies.get("admin_token"));
	if (!me) return json({ error: "未登录" }, { status: 401 });

	let ip = "";
	try { ip = event.getClientAddress(); } catch { /* noop */ }
	const ua = request.headers.get("user-agent") || "";
	const body = await request.json();
	const action = body.action;

	if (action === "update") {
		if (!can(me.role, "manageUsers")) return json({ error: "无权限" }, { status: 403 });
		const r = adminUpdateUser(body.username, {
			displayName: body.displayName,
			email: body.email,
			bio: body.bio,
			role: body.role as Role | undefined,
			status: body.status
		});
		if (r.ok) {
			recordActivity({ userId: me.id, username: me.username, action: "user_update", target: body.username, ip, userAgent: ua });
		}
		return r.ok ? json({ ok: true }) : json({ error: r.error }, { status: 400 });
	}

	if (action === "delete") {
		if (!can(me.role, "manageUsers")) return json({ error: "无权限" }, { status: 403 });
		const r = deleteUser(body.username);
		if (r.ok) {
			recordActivity({ userId: me.id, username: me.username, action: "user_delete", target: body.username, ip, userAgent: ua });
		}
		return r.ok ? json({ ok: true }) : json({ error: r.error }, { status: 400 });
	}

	if (action === "revoke_sessions") {
		if (!can(me.role, "manageUsers") && body.username !== me.username) {
			return json({ error: "无权限" }, { status: 403 });
		}
		const n = revokeSessions(body.username || me.username);
		recordActivity({ userId: me.id, username: me.username, action: "session_revoke", target: body.username || me.username, detail: `吊销 ${n} 个会话`, ip, userAgent: ua });
		return json({ ok: true, revoked: n });
	}

	return json({ error: "unknown action" }, { status: 400 });
}
