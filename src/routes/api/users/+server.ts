import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { verifyToken, getUser, adminUpdateUser, deleteUser, revokeSessions } from "$lib/server/auth.js";
import { listUsersOverview, listActivities, onlineUsers, recordActivity } from "$lib/server/activity.js";
import { syncUserUpdateToCims } from "$lib/server/cims-account.js";
import { can, userCan } from "$lib/permissions.js";
import type { Role } from "$lib/permissions.js";

/**
 * 多用户资源端点（需 viewAdmin / manageUsers）。
 *
 * GET  /api/users                  —— 用户总览（含在线态 / 会话数 / 活动数）
 * GET  /api/users?username=xxx     —— 单用户详情 + 其近期活动
 * POST /api/users { action }       —— update | delete | revoke_sessions
 *
 * 「账号跟随 website 同步」：update / delete 之后把变更镜像到 CIMS（website 为账号权威）。
 * 同步是 fail-open 的 —— CIMS 不可达不影响本地操作结果，只在响应里带 sync 字段说明。
 */
export function GET(event: RequestEvent) {
	const { url, cookies } = event;
	const me = verifyToken(cookies.get("admin_token"));
	if (!me) return json({ error: "未登录" }, { status: 401 });
	if (!userCan(me, "viewAdmin")) return json({ error: "无权限" }, { status: 403 });

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
		if (!userCan(me, "manageUsers")) return json({ error: "无权限" }, { status: 403 });
		const r = adminUpdateUser(body.username, {
			displayName: body.displayName,
			email: body.email,
			bio: body.bio,
			role: body.role as Role | undefined,
			status: body.status
		});
		if (r.ok) {
			recordActivity({ userId: me.id, username: me.username, action: "user_update", target: body.username, ip, userAgent: ua });
			// 镜像到 CIMS：角色 / 邮箱 / 显示名 / 停启用 / 班级年级。
			// 取更新后的用户记录（而不是请求体）作为同步源，避免把未填的字段覆盖成空。
			const after = getUser(body.username);
			if (after?.email) {
				const sync = await syncUserUpdateToCims({
					email: after.email,
					username: after.username,
					displayName: after.displayName,
					role: after.role,
					// User.status 的取值只有 active / disabled / pending（没有 banned），
					// 写成 `!== "banned"` 是无重叠比较 —— 类型检查会报错，且是错觉式安全。
					active: after.status !== "disabled",
					className: body.className,
					gradeName: body.gradeName
				});
				return json({ ok: true, sync });
			}
		}
		return r.ok ? json({ ok: true }) : json({ error: r.error }, { status: 400 });
	}

	if (action === "delete") {
		if (!userCan(me, "manageUsers")) return json({ error: "无权限" }, { status: 403 });
		// 先留一份邮箱/用户名用于同步，删除后本地就查不到了
		const before = getUser(body.username);
		const r = deleteUser(body.username);
		if (r.ok) {
			recordActivity({ userId: me.id, username: me.username, action: "user_delete", target: body.username, ip, userAgent: ua });
			// CIMS 侧没有「删除用户」，用停用表达「该账号不再可用」——
			// 直接删会导致该账号在 CIMS 的历史审计/资源归属断链。
			if (before?.email) {
				const sync = await syncUserUpdateToCims({ email: before.email, active: false });
				return json({ ok: true, sync });
			}
		}
		return r.ok ? json({ ok: true }) : json({ error: r.error }, { status: 400 });
	}

	if (action === "revoke_sessions") {
		if (!userCan(me, "manageUsers") && body.username !== me.username) {
			return json({ error: "无权限" }, { status: 403 });
		}
		const n = revokeSessions(body.username || me.username);
		recordActivity({ userId: me.id, username: me.username, action: "session_revoke", target: body.username || me.username, detail: `吊销 ${n} 个会话`, ip, userAgent: ua });
		return json({ ok: true, revoked: n });
	}

	return json({ error: "unknown action" }, { status: 400 });
}
