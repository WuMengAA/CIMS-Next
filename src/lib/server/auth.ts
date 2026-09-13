/**
 * 认证与会话 —— SQLite 驱动（见 db.ts）。
 *
 * 对外签名保持与旧 JSON 版一致（verifyLogin / getUsers / createUser /
 * deleteUser / changePassword / makeToken / verifyToken），因此所有既有调用点
 * （hooks、layout load、各 API 路由）无需改动即可平滑切换。
 *
 * 相对旧实现的两处实质升级：
 * 1. `makeToken` 由「用户名+盐 的确定性哈希」改为「随机会话令牌」，落 sessions 表，
 *    支持过期、滑动续期、按用户批量吊销（改密即踢下线）。
 * 2. 用户模型扩展 email / avatar / bio / status / lastLoginAt / loginCount，
 *    为多用户系统与资料保存提供字段。
 */
import crypto from "node:crypto";
import type { Role } from "$lib/permissions.js";
import { getDb, hashPassword as _hashPassword, nowIso } from "./db.js";

export interface User {
	/** 数据库自增主键（旧 JSON 版本没有该字段，新代码按可选处理）。 */
	id?: number;
	username: string;
	passwordHash: string;
	salt: string;
	displayName: string;
	role: Role;
	createdAt: string;
	/** ---- 多用户扩展字段 ---- */
	email?: string;
	avatar?: string;
	bio?: string;
	status?: "active" | "disabled" | "pending";
	verified?: boolean;
	verifyToken?: string;
	verifyTokenExpires?: string;
	updatedAt?: string;
	lastLoginAt?: string | null;
	lastLoginIp?: string | null;
	loginCount?: number;
	/** 集控面板班级身份（新账号引导补充；用户自填）。 */
	className?: string;
	gradeName?: string;
}

/** 会话有效期：30 天。 */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** last_seen 写入节流：60 秒内最多落库一次，避免每请求写放大。 */
const SEEN_TOUCH_MS = 60 * 1000;

export function hashPassword(password: string, salt: string): string {
	return _hashPassword(password, salt);
}

interface UserRow {
	id: number;
	username: string;
	display_name: string;
	email: string;
	avatar: string;
	bio: string;
	role: string;
	status: string;
	verified: number;
	verify_token: string;
	verify_token_expires: string;
	password_hash: string;
	salt: string;
	created_at: string;
	updated_at: string;
	last_login_at: string | null;
	last_login_ip: string | null;
	login_count: number;
	class_name: string;
	grade_name: string;
}

function rowToUser(r: UserRow): User {
	return {
		id: r.id,
		username: r.username,
		displayName: r.display_name || r.username,
		email: r.email || "",
		avatar: r.avatar || "",
		bio: r.bio || "",
		role: (r.role as Role) || "user",
		status: r.status === "active" ? "active" : r.status === "disabled" ? "disabled" : "pending",
		verified: !!r.verified,
		verifyToken: r.verify_token || "",
		verifyTokenExpires: r.verify_token_expires || "",
		passwordHash: r.password_hash,
		salt: r.salt,
		createdAt: r.created_at,
		updatedAt: r.updated_at,
		lastLoginAt: r.last_login_at,
		lastLoginIp: r.last_login_ip,
		loginCount: r.login_count ?? 0,
		className: r.class_name || "",
		gradeName: r.grade_name || ""
	};
}

const SELECT_USER = `SELECT id, username, display_name, email, avatar, bio, role, status, verified, verify_token, verify_token_expires,
	password_hash, salt, created_at, updated_at, last_login_at, last_login_ip, login_count, class_name, grade_name FROM users`;

export function getUsers(): User[] {
	reconcileAdmin();
	const rows = getDb().prepare(`${SELECT_USER} ORDER BY created_at ASC`).all() as unknown as UserRow[];
	return rows.map(rowToUser);
}

/** 内置 admin 的口令以环境变量 ADMIN_PASSWORD 为权威来源（沿用旧行为）。 */
let adminReconciled = false;
function reconcileAdmin() {
	if (adminReconciled) return;
	adminReconciled = true;
	const envPw = process.env.ADMIN_PASSWORD;
	if (!envPw) return;
	const db = getDb();
	const admin = db.prepare(`${SELECT_USER} WHERE username = 'admin'`).get() as unknown as UserRow | undefined;
	if (!admin) return;
	const expected = hashPassword(envPw, admin.salt);
	if (expected !== admin.password_hash) {
		db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE username = 'admin'").run(expected, nowIso());
	}
}

export function getUser(username: string): User | null {
	const row = getDb().prepare(`${SELECT_USER} WHERE username = ?`).get(username) as unknown as UserRow | undefined;
	return row ? rowToUser(row) : null;
}

export function verifyLogin(username: string, password: string): User | null {
	const user = getUser(username);
	if (!user) return null;
	const hash = hashPassword(password, user.salt);
	if (hash !== user.passwordHash) return null;
	if (user.status !== "active") return null; // 停用 / 待验证均不可登录
	return user;
}

export function createUser(
	username: string,
	password: string,
	displayName: string,
	role: Role = "editor",
	extra: { email?: string; bio?: string } = {}
): { ok: boolean; error?: string } {
	const name = username.trim();
	if (!name || !password || password.length < 6) {
		return { ok: false, error: "用户名不能为空，密码至少 6 位" };
	}
	if (getUser(name)) {
		return { ok: false, error: "用户名已存在" };
	}
	const salt = crypto.randomBytes(16).toString("hex");
	const ts = nowIso();
	getDb()
		.prepare(
			`INSERT INTO users (username, display_name, email, avatar, bio, role, status, verified, password_hash, salt, created_at, updated_at, login_count)
			 VALUES (?, ?, ?, '', ?, ?, 'active', 1, ?, ?, ?, ?, 0)`
		)
		.run(name, displayName.trim() || name, extra.email?.trim() || "", extra.bio?.trim() || "", role, hashPassword(password, salt), salt, ts, ts);
	return { ok: true };
}

/** 按邮箱查重（仅返回是否存在，不泄露明细）。 */
export function isEmailTaken(email: string): boolean {
	if (!email) return false;
	const row = getDb().prepare("SELECT id FROM users WHERE email = ?").get(email);
	return !!row;
}

/** 按邮箱取用户（用于重发验证）。 */
export function getUserByEmail(email: string): User | null {
	if (!email) return null;
	const row = getDb().prepare(`${SELECT_USER} WHERE email = ?`).get(email) as unknown as UserRow | undefined;
	return row ? rowToUser(row) : null;
}

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * 开放注册：创建「待验证」账号（status=pending）。
 * 默认角色 user，无需管理员介入；验证邮箱或管理员批准后方可登录。
 */
export function registerUser(
	username: string,
	email: string,
	password: string,
	displayName?: string
): { ok: boolean; error?: string; verifyToken?: string; username?: string; email?: string } {
	const name = (username || "").trim();
	const mail = (email || "").trim();
	const nick = (displayName || "").trim();
	if (!name || !password) return { ok: false, error: "用户名和密码必填" };
	if (password.length < 6) return { ok: false, error: "密码至少 6 位" };
	if (!/^[a-zA-Z0-9_\u4e00-\u9fff]{2,20}$/.test(name)) {
		return { ok: false, error: "用户名 2-20 位，仅含字母 / 数字 / 下划线 / 汉字" };
	}
	if (mail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) {
		return { ok: false, error: "邮箱格式不正确" };
	}
	if (getUser(name)) return { ok: false, error: "用户名已存在" };
	if (mail && isEmailTaken(mail)) return { ok: false, error: "该邮箱已被注册" };

	const salt = crypto.randomBytes(16).toString("hex");
	const token = crypto.randomBytes(32).toString("base64url");
	const ts = nowIso();
	const exp = new Date(Date.now() + VERIFY_TTL_MS).toISOString();
	getDb()
		.prepare(
			`INSERT INTO users
			  (username, display_name, email, avatar, bio, role, status, verified, verify_token, verify_token_expires, password_hash, salt, created_at, updated_at, login_count)
			 VALUES (?, ?, ?, '', '', 'user', 'pending', 0, ?, ?, ?, ?, ?, ?, 0)`
		)
		.run(name, nick || name, mail, token, exp, hashPassword(password, salt), salt, ts, ts);
	return { ok: true, verifyToken: token, username: name, email: mail };
}

/** 消费验证令牌：激活账号（status=active, verified=1）。 */
export function verifyEmail(token: string): { ok: boolean; error?: string } {
	if (!token) return { ok: false, error: "缺少验证令牌" };
	const db = getDb();
	const row = db.prepare("SELECT id, status, verify_token_expires FROM users WHERE verify_token = ?").get(token) as
		| { id: number; status: string; verify_token_expires: string }
		| undefined;
	if (!row) return { ok: false, error: "验证链接无效或已使用" };
	if (row.status !== "pending") return { ok: false, error: "账号已激活" };
	const exp = Date.parse(row.verify_token_expires || "");
	if (!Number.isFinite(exp) || exp < Date.now()) {
		return { ok: false, error: "验证链接已过期，请重新获取" };
	}
	db.prepare("UPDATE users SET status = 'active', verified = 1, verify_token = '', verify_token_expires = '', updated_at = ? WHERE id = ?").run(
		nowIso(),
		row.id
	);
	return { ok: true };
}

/** 重发验证令牌（按用户名或邮箱）。 */
export function resendVerification(identifier: string): { ok: boolean; error?: string; verifyToken?: string; email?: string } {
	const user = getUser(identifier) || getUserByEmail(identifier || "");
	if (!user) return { ok: false, error: "账号不存在" };
	if (user.status === "active" && user.verified) return { ok: false, error: "账号已激活" };
	const token = crypto.randomBytes(32).toString("base64url");
	const exp = new Date(Date.now() + VERIFY_TTL_MS).toISOString();
	getDb()
		.prepare("UPDATE users SET verify_token = ?, verify_token_expires = ?, updated_at = ? WHERE id = ?")
		.run(token, exp, nowIso(), user.id ?? -1);
	return { ok: true, verifyToken: token, email: user.email };
}

export function deleteUser(username: string): { ok: boolean; error?: string } {
	if (username === "admin") {
		return { ok: false, error: "不能删除内置管理员" };
	}
	const user = getUser(username);
	if (!user) {
		return { ok: false, error: "用户不存在" };
	}
	const db = getDb();
	db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id ?? -1);
	db.prepare("DELETE FROM users WHERE id = ?").run(user.id ?? -1);
	return { ok: true };
}

export function changePassword(username: string, newPassword: string): { ok: boolean; error?: string } {
	if (!newPassword || newPassword.length < 6) {
		return { ok: false, error: "密码至少 6 位" };
	}
	const user = getUser(username);
	if (!user) return { ok: false, error: "用户不存在" };
	const salt = crypto.randomBytes(16).toString("hex");
	const db = getDb();
	db.prepare("UPDATE users SET salt = ?, password_hash = ?, updated_at = ? WHERE id = ?").run(
		salt,
		hashPassword(newPassword, salt),
		nowIso(),
		user.id ?? -1
	);
	// 改密后吊销该用户全部会话（旧令牌立即失效）。
	revokeSessions(username);
	return { ok: true };
}

/** 更新资料（本人可改：昵称 / 邮箱 / 简介 / 头像 / 显示名）。 */
export function updateProfile(
	username: string,
	patch: { displayName?: string; email?: string; bio?: string; avatar?: string; className?: string; gradeName?: string }
): { ok: boolean; error?: string } {
	const user = getUser(username);
	if (!user) return { ok: false, error: "用户不存在" };
	const db = getDb();
	db.prepare(
		`UPDATE users SET display_name = ?, email = ?, bio = ?, avatar = ?, class_name = ?, grade_name = ?, updated_at = ? WHERE id = ?`
	).run(
		(patch.displayName ?? user.displayName ?? "").trim() || user.username,
		(patch.email ?? user.email ?? "").trim(),
		patch.bio ?? user.bio ?? "",
		patch.avatar ?? user.avatar ?? "",
		(patch.className ?? user.className ?? "").trim(),
		(patch.gradeName ?? user.gradeName ?? "").trim(),
		nowIso(),
		user.id ?? -1
	);
	return { ok: true };
}

/** 管理端更新（角色 / 状态 / 资料）。 */
export function adminUpdateUser(
	username: string,
	patch: { displayName?: string; email?: string; bio?: string; role?: Role; status?: "active" | "disabled"; className?: string; gradeName?: string }
): { ok: boolean; error?: string } {
	const user = getUser(username);
	if (!user) return { ok: false, error: "用户不存在" };
	if (username === "admin" && patch.role && patch.role !== "admin") {
		return { ok: false, error: "不能降级内置管理员" };
	}
	if (username === "admin" && patch.status === "disabled") {
		return { ok: false, error: "不能停用内置管理员" };
	}
	const db = getDb();
	db.prepare(
		`UPDATE users SET display_name = ?, email = ?, bio = ?, role = ?, status = ?, class_name = ?, grade_name = ?, updated_at = ? WHERE id = ?`
	).run(
		(patch.displayName ?? user.displayName ?? "").trim() || user.username,
		(patch.email ?? user.email ?? "").trim(),
		patch.bio ?? user.bio ?? "",
		patch.role ?? user.role,
		patch.status ?? user.status ?? "active",
		(patch.className ?? user.className ?? "").trim(),
		(patch.gradeName ?? user.gradeName ?? "").trim(),
		nowIso(),
		user.id ?? -1
	);
	if (patch.status === "disabled") revokeSessions(username);
	// 管理员批准（置 active）等价于完成验证。
	if (patch.status === "active") {
		getDb().prepare("UPDATE users SET verified = 1 WHERE id = ?").run(user.id ?? -1);
	}
	return { ok: true };
}

/** 吊销某用户全部会话（不删账号）。 */
export function revokeSessions(username: string): number {
	const user = getUser(username);
	if (!user) return 0;
	const info = getDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id ?? -1);
	return Number(info.changes ?? 0);
}

// ── 会话令牌 ────────────────────────────────────────────────────────────────

export interface SessionMeta {
	ip?: string;
	userAgent?: string;
}

/** 建立登录会话，返回随机会话令牌。 */
export function makeToken(user: User, meta: SessionMeta = {}): string {
	const token = crypto.randomBytes(32).toString("base64url");
	const now = Date.now();
	const db = getDb();
	db.prepare(
		`INSERT INTO sessions (token, user_id, created_at, last_seen_at, expires_at, ip, user_agent)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`
	).run(
		token,
		user.id ?? -1,
		new Date(now).toISOString(),
		new Date(now).toISOString(),
		new Date(now + SESSION_TTL_MS).toISOString(),
		(meta.ip || "").slice(0, 64),
		(meta.userAgent || "").slice(0, 300)
	);
	return token;
}

/** 记录一次成功登录（用于 last_login 与活动流）。 */
export function markLogin(username: string, ip = ""): void {
	const user = getUser(username);
	if (!user) return;
	getDb()
		.prepare("UPDATE users SET last_login_at = ?, last_login_ip = ?, login_count = login_count + 1 WHERE id = ?")
		.run(nowIso(), ip.slice(0, 64), user.id ?? -1);
}

/** 销毁单个会话（登出）。 */
export function destroySession(token: string | undefined | null): void {
	if (!token) return;
	try {
		getDb().prepare("DELETE FROM sessions WHERE token = ?").run(token);
	} catch { /* noop */ }
}

/** 校验会话令牌 → 用户；命中时滑动续期并节流刷新 last_seen。 */
export function verifyToken(token: string | undefined | null): User | null {
	if (!token) return null;
	try {
		const db = getDb();
		const row = db
			.prepare(
				`SELECT s.last_seen_at AS s_seen, s.expires_at AS s_exp,
				        u.id, u.username, u.display_name, u.email, u.avatar, u.bio, u.role, u.status,
				        u.password_hash, u.salt, u.created_at, u.updated_at, u.last_login_at, u.last_login_ip, u.login_count,
				        u.class_name, u.grade_name
				 FROM sessions s JOIN users u ON u.id = s.user_id
				 WHERE s.token = ?`
			)
			.get(token) as unknown as (UserRow & { s_seen: string; s_exp: string }) | undefined;
		if (!row) return null;

		const now = Date.now();
		const exp = Date.parse(row.s_exp);
		if (!Number.isFinite(exp) || exp < now) {
			db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
			return null;
		}
		if (row.status === "disabled") return null;

		// 节流刷新 last_seen + 滑动续期
		const seen = Date.parse(row.s_seen);
		if (!Number.isFinite(seen) || now - seen > SEEN_TOUCH_MS) {
			db.prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token = ?").run(
				new Date(now).toISOString(),
				new Date(now + SESSION_TTL_MS).toISOString(),
				token
			);
		}
		return rowToUser(row);
	} catch {
		return null;
	}
}
