import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import {
	verifyLogin,
	makeToken,
	destroySession,
	createUser,
	deleteUser,
	changePassword,
	updateProfile,
	adminUpdateUser,
	getUser,
	revokeSessions,
	verifyToken,
	markLogin
} from "$lib/server/auth.js";
import { listUsersOverview, recordActivity } from "$lib/server/activity.js";
import type { Role } from "$lib/permissions.js";

function clientMeta(event: RequestEvent) {
	let ip = "";
	try { ip = event.getClientAddress(); } catch { /* 适配器不支持时忽略 */ }
	return { ip, userAgent: event.request.headers.get("user-agent") || "" };
}

export async function POST(event: RequestEvent) {
	const { request, cookies } = event;
	const body = await request.json();
	const action = body.action || "login";
	const meta = clientMeta(event);

	if (action === "login") {
		const { username, password } = body;
		if (!username || !password) {
			return json({ error: "请输入用户名和密码" }, { status: 400 });
		}
		const user = verifyLogin(username, password);
		if (!user) {
			return json({ error: "用户名或密码错误" }, { status: 401 });
		}
		const token = makeToken(user, meta);
		cookies.set("admin_token", token, {
			path: "/",
			httpOnly: true,
			sameSite: "strict",
			secure: false,
			maxAge: 30 * 24 * 60 * 60
		});
		markLogin(user.username, meta.ip);
		recordActivity({ userId: user.id, username: user.username, action: "login", ip: meta.ip, userAgent: meta.userAgent });
		return json({
			ok: true,
			user: { username: user.username, displayName: user.displayName, role: user.role, avatar: user.avatar || "" }
		});
	}

	if (action === "logout") {
		const current = verifyToken(cookies.get("admin_token"));
		destroySession(cookies.get("admin_token"));
		if (current) {
			recordActivity({ userId: current.id, username: current.username, action: "logout", ip: meta.ip, userAgent: meta.userAgent });
		}
		cookies.delete("admin_token", { path: "/" });
		return json({ ok: true });
	}

	// 以下动作均需登录
	const current = verifyToken(cookies.get("admin_token"));
	if (!current) return json({ error: "未登录" }, { status: 401 });
	const isAdmin = current.role === "admin";

	if (action === "create_user") {
		if (!isAdmin) return json({ error: "无权限" }, { status: 403 });
		const result = createUser(body.username, body.password, body.displayName, (body.role as Role) || "editor", {
			email: body.email
		});
		if (result.ok) {
			recordActivity({
				userId: current.id, username: current.username, action: "user_create",
				target: body.username, detail: `角色 ${body.role || "editor"}`, ip: meta.ip, userAgent: meta.userAgent
			});
		}
		return result.ok ? json({ ok: true }) : json({ error: result.error }, { status: 400 });
	}

	if (action === "delete_user") {
		if (!isAdmin) return json({ error: "无权限" }, { status: 403 });
		const result = deleteUser(body.username);
		if (result.ok) {
			recordActivity({
				userId: current.id, username: current.username, action: "user_delete",
				target: body.username, ip: meta.ip, userAgent: meta.userAgent
			});
		}
		return result.ok ? json({ ok: true }) : json({ error: result.error }, { status: 400 });
	}

	if (action === "change_password") {
		const target = body.username || current.username;
		if (target !== current.username && !isAdmin) {
			return json({ error: "无权限" }, { status: 403 });
		}
		const result = changePassword(target, body.newPassword);
		if (result.ok) {
			recordActivity({
				userId: current.id, username: current.username, action: "password_change",
				target, ip: meta.ip, userAgent: meta.userAgent
			});
		}
		return result.ok ? json({ ok: true }) : json({ error: result.error }, { status: 400 });
	}

	if (action === "update_profile") {
		const target = body.username || current.username;
		if (target !== current.username && !isAdmin) {
			return json({ error: "无权限" }, { status: 403 });
		}
		const result = updateProfile(target, {
			displayName: body.displayName,
			email: body.email,
			bio: body.bio,
			avatar: body.avatar
		});
		if (result.ok) {
			recordActivity({
				userId: current.id, username: current.username, action: "profile_update",
				target, ip: meta.ip, userAgent: meta.userAgent
			});
		}
		return result.ok ? json({ ok: true, user: (() => {
			const u = getUser(target);
			return u ? { username: u.username, displayName: u.displayName, email: u.email, bio: u.bio, avatar: u.avatar, role: u.role } : null;
		})() }) : json({ error: result.error }, { status: 400 });
	}

	if (action === "update_user") {
		if (!isAdmin) return json({ error: "无权限" }, { status: 403 });
		const result = adminUpdateUser(body.username, {
			displayName: body.displayName,
			email: body.email,
			bio: body.bio,
			role: body.role as Role | undefined,
			status: body.status as "active" | "disabled" | undefined
		});
		if (result.ok) {
			const bits: string[] = [];
			if (body.role) bits.push(`角色→${body.role}`);
			if (body.status) bits.push(`状态→${body.status}`);
			recordActivity({
				userId: current.id, username: current.username, action: "user_update",
				target: body.username, detail: bits.join("，"), ip: meta.ip, userAgent: meta.userAgent
			});
		}
		return result.ok ? json({ ok: true }) : json({ error: result.error }, { status: 400 });
	}

	if (action === "revoke_sessions") {
		if (!isAdmin && body.username !== current.username) {
			return json({ error: "无权限" }, { status: 403 });
		}
		const n = revokeSessions(body.username || current.username);
		recordActivity({
			userId: current.id, username: current.username, action: "session_revoke",
			target: body.username || current.username, detail: `吊销 ${n} 个会话`, ip: meta.ip, userAgent: meta.userAgent
		});
		return json({ ok: true, revoked: n });
	}

	return json({ error: "unknown action" }, { status: 400 });
}

export async function GET(event: RequestEvent) {
	const { cookies } = event;
	const user = verifyToken(cookies.get("admin_token"));
	if (!user) return json({ error: "未登录" }, { status: 401 });

	// 管理员拿到完整总览（含在线、会话数、活动数）；其他角色只能看到自己。
	if (user.role === "admin") {
		return json({ users: listUsersOverview(), current: user.username });
	}
	const self = getUser(user.username);
	return json({
		users: self
			? [{
					username: self.username,
					displayName: self.displayName,
					email: self.email,
					bio: self.bio,
					avatar: self.avatar,
					role: self.role,
					createdAt: self.createdAt
				}]
			: [],
		current: user.username
	});
}
