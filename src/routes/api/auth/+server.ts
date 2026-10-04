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
	markLogin,
	registerUser,
	verifyEmail,
	resendVerification
} from "$lib/server/auth.js";
import { checkLoginLock, recordLoginFailure, clearLoginFailures } from "$lib/server/login-guard.js";
import { listUsersOverview, recordActivity } from "$lib/server/activity.js";
import { syncUserToCims } from "$lib/server/cims-account.js";
import { can, type Role } from "$lib/permissions.js";

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
		// ── 防爆破（2026-09-27）：命中锁定直接拒绝，不验密码（省 CPU 也在明示"别试了"）
		const lock = checkLoginLock(username, meta.ip);
		if (lock.locked) {
			recordActivity({ username, action: "login", detail: "账号/来源已锁定，拒绝尝试", ip: meta.ip, userAgent: meta.userAgent });
			return json({ error: "尝试过于频繁，请 " + Math.ceil(lock.retryAfterSec / 60) + " 分钟后再试" }, { status: 429 });
		}
		const user = verifyLogin(username, password);
		if (!user) {
			recordLoginFailure(username, meta.ip);
			recordActivity({ username, action: "login", detail: "密码错误（失败计数）", ip: meta.ip, userAgent: meta.userAgent });
			// 区分「待验证」与「密码错误」：pending 用户给出可操作提示，其余统一按凭证错误处理。
			const pendingUser = getUser(username);
			if (pendingUser && pendingUser.status === "pending") {
				return json({ error: "账号待验证：请先点击邮箱验证链接完成激活" }, { status: 403 });
			}
			return json({ error: "用户名或密码错误" }, { status: 401 });
		}
		// 登录时限（天）：默认 30，可选 60/120，过期需重新登录（2026-09-27 安全改造）。
		const ttlDays = Math.min(Math.max(Number(body.ttl_days ?? 30), 1), 365);
		const token = makeToken(user, { ...meta, ttlDays });
		cookies.set("admin_token", token, {
			path: "/",
			httpOnly: true,
			sameSite: "strict",
			// 跟随 COOKIE_SECURE：HTTPS 生产环境置 true（标记 Secure，防中间人）；
			// 本地 HTTP 开发（COOKIE_SECURE 非 true）保持 false，否则浏览器会拒收 Cookie 导致无法登录。
			secure: process.env.COOKIE_SECURE === "true",
			maxAge: ttlDays * 24 * 60 * 60
		});
		markLogin(user.username, meta.ip);
		clearLoginFailures(user.username, meta.ip);
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

	if (action === "register") {
		const result = registerUser(body.username, body.email, body.password, body.displayName, { inviteCode: body.inviteCode });
		if (!result.ok) return json({ error: result.error }, { status: 400 });

		// 镜像到 CIMS（website 为账号权威）。明文密码只在注册这一刻存在于请求体
		// （库里只存哈希），故同步必须在此处发生；CIMS 侧幂等，失败不阻断注册
		// （fail-open，仅记日志）。
		// CIMS 以 email 作为账号键，无邮箱的注册无法镜像，跳过以免产生无效调用。
		const syncEmail = result.email || body.email || "";
		if (syncEmail) {
			syncUserToCims({
				email: syncEmail,
				username: result.username,
				password: body.password,
				displayName: body.displayName
			}).catch((e) => console.error("[cims-sync]", e));
		}

		recordActivity({
			userId: 0, username: result.username || "", action: "user_register",
			detail: "开放注册（待验证）", ip: meta.ip, userAgent: meta.userAgent
		});
		// 2026-10-04 安全修复：verifyToken 只在邮件渠道可用时回传（见 registerUser 注释）。
		// 无 SMTP 时账号保持 pending，需管理员激活 —— 绝不把激活钥匙发给客户端。
		return json({
			ok: true,
			username: result.username,
			email: result.email,
			mailAvailable: result.mailAvailable !== false,
			...(result.mailAvailable !== false && result.verifyToken ? { verifyToken: result.verifyToken } : {})
		});
	}

	if (action === "verify") {
		const result = verifyEmail(body.token);
		if (!result.ok) return json({ error: result.error }, { status: 400 });
		return json({ ok: true });
	}

	if (action === "resend_verification") {
		const result = resendVerification(body.identifier);
		if (!result.ok) return json({ error: result.error }, { status: 400 });
		recordActivity({
			userId: 0, username: body.identifier || "", action: "user_verify_resend",
			ip: meta.ip, userAgent: meta.userAgent
		});
		// 2026-10-04 安全修复：无邮件渠道时同样不回传 verifyToken（防 resend 自激活）。
		return json({
			ok: true,
			email: result.email,
			mailAvailable: result.mailAvailable !== false,
			...(result.mailAvailable !== false && result.verifyToken ? { verifyToken: result.verifyToken } : {})
		});
	}

	// 以下动作均需登录
	const current = verifyToken(cookies.get("admin_token"));
	if (!current) return json({ error: "未登录" }, { status: 401 });
	// T12（2026-10-03）：原判 `role === "admin"` 把站长(owner) 当普通用户。
	// 用户管理语义 = manageUsers（admin 与 owner 同持该能力，行为对 admin 完全不变）。
	const isAdmin = can(current.role, "manageUsers");

	if (action === "create_user") {
		if (!isAdmin) return json({ error: "无权限" }, { status: 403 });
		const result = createUser(body.username, body.password, body.displayName, (body.role as Role) || "editor", {
			email: body.email
		});
		if (result.ok) {
			// 管理员代建的账号同样镜像到 CIMS（无邮箱则跳过，CIMS 以 email 为键）。
			const syncEmail = (body.email || "").trim();
			if (syncEmail) {
				syncUserToCims({
					email: syncEmail,
					username: body.username,
					password: body.password,
					displayName: body.displayName
				}).catch((e) => console.error("[cims-sync]", e));
			}
			recordActivity({
				userId: current.id, username: current.username, action: "user_create",
				target: body.username, detail: `角色 ${body.role || "editor"}`, ip: meta.ip, userAgent: meta.userAgent
			});
		}
		return result.ok ? json({ ok: true }) : json({ error: result.error }, { status: 400 });
	}

	if (action === "delete_user") {
		if (!isAdmin) return json({ error: "无权限" }, { status: 403 });
		// 安全网补强（2026-09-27）：删除账号不可恢复，需管理员本人密码复核，
		// 防会话被盗后批量删人。
		if (!verifyLogin(current.username, String(body.currentPassword || ""))) {
			return json({ error: "删除账号需验证管理员密码" }, { status: 400 });
		}
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
		// 安全网补强（2026-09-27）：改密码必须复核当前密码，防止会话被盗后静默改密。
		// 管理员改他人密码是特权操作，同样需要管理员自己的密码做二次确认。
		const verifyTarget = target === current.username ? current.username : target;
		const currentPassword = body.currentPassword || "";
		if (!verifyLogin(verifyTarget, currentPassword)) {
			recordActivity({
				userId: current.id, username: current.username, action: "password_change",
				detail: "复核失败（密码不正确），已拒绝", target, ip: meta.ip, userAgent: meta.userAgent
			});
			return json({ error: "当前密码不正确，已拒绝修改" }, { status: 400 });
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
		// 安全网补强（2026-09-27）：改邮箱属敏感操作（绑错邮箱 = 账号可能被劫持），
		// 必须复核当前密码；仅改昵称/简介/头像不要求（日常资料更新不应碍事）。
		if (body.email && body.email !== current.email) {
			const currentPassword = body.currentPassword || "";
			if (!verifyLogin(current.username, currentPassword)) {
				return json({ error: "修改邮箱需先验证当前密码" }, { status: 400 });
			}
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
		// 安全网补强（2026-09-27）：提权（改角色）/改状态/改邮箱都是敏感操作，
		// 需管理员本人密码复核；仅改昵称/简介等非敏感字段可不验。
		const sensitive = body.role || body.status || (body.email && body.email !== current.email);
		if (sensitive && !verifyLogin(current.username, String(body.currentPassword || ""))) {
			return json({ error: "敏感修改需验证管理员密码" }, { status: 400 });
		}
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
