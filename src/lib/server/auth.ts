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
import type { Role, TitleKey } from "$lib/permissions.js";
import { TITLE_KEYS } from "$lib/permissions.js";
import { getDb, hashPassword as _hashPassword, nowIso } from "./db.js";
import { sendMail, mailEnabled } from "./mailer.js";
import { env } from "$env/dynamic/private";

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
	/** 经验值（#248）：经验等级 xp→Lv 的数据源；纯展示，与权限/角色零耦合。 */
	xp?: number;
	/**
	 * 该用户被显式授予的称号集合（来自 user_titles 表）。
	 * - 非空数组 = 完整覆盖：以该集合为有效称号（可增可减，脱离角色预设）。
	 * - null/undefined = 继承角色预设（ROLE_TITLES）。
	 * 权限判定走 userCan()（permissions.ts），以此字段优先。
	 */
	titles?: TitleKey[] | null;
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
	xp: number;
}

async function rowToUser(r: UserRow): Promise<User> {
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
		gradeName: r.grade_name || "",
		xp: r.xp ?? 0,
		titles: r.id != null ? await getUserTitles(r.id) : null
	};
}

/**
 * 取某用户被显式授予的称号集合（user_titles 表）。
 * - 有行 → 返回去重、且经 TITLE_KEYS 校验的有效键数组（完整覆盖角色预设）。
 * - 无行 → 返回 null，调用方（userCan）回退到角色预设。
 * 表不存在等异常 → 返回 null（不阻断登录）。
 */
export async function getUserTitles(userId: number): Promise<TitleKey[] | null> {
	if (userId == null || Number.isNaN(userId)) return null;
	try {
		const valid = new Set<string>(TITLE_KEYS);
		const rows = await getDb()
			.prepare("SELECT title_key FROM user_titles WHERE user_id = ?")
			.all(userId) as unknown as { title_key: string }[];
		if (!rows || rows.length === 0) return null;
		const keys = rows.map((x) => x.title_key).filter((k) => valid.has(k)) as TitleKey[];
		return keys.length ? keys : null;
	} catch {
		return null;
	}
}

/** 设置某用户的称号集合（完整覆盖写：先清后插）。传空数组 = 清空所有显式称号（回退角色预设）。 */
export async function setUserTitles(userId: number, titles: TitleKey[]): Promise<void> {
	const valid = new Set<string>(TITLE_KEYS);
	const clean = Array.from(new Set(titles.filter((t) => valid.has(t))));
	const db = getDb();
	// node:sqlite 的 DatabaseSync 没有 better-sqlite3 的 .transaction()，
	// 用显式事务保证「清空 + 重插」的原子性。
	await db.exec("BEGIN");
	try {
		await db.prepare("DELETE FROM user_titles WHERE user_id = ?").run(userId);
		const ins = await db.prepare("INSERT OR IGNORE INTO user_titles (user_id, title_key) VALUES (?, ?)");
		for (const t of clean) await ins.run(userId, t);
		await db.exec("COMMIT");
	} catch (e) {
		await db.exec("ROLLBACK");
		throw e;
	}
}

/** 在现有集合上追加/撤回单个称号（幂等）。 */
export async function addUserTitle(userId: number, title: TitleKey): Promise<void> {
	if (!TITLE_KEYS.includes(title)) return;
	await getDb().prepare("INSERT OR IGNORE INTO user_titles (user_id, title_key) VALUES (?, ?)").run(userId, title);
}
export async function removeUserTitle(userId: number, title: TitleKey): Promise<void> {
	await getDb().prepare("DELETE FROM user_titles WHERE user_id = ? AND title_key = ?").run(userId, title);
}

const SELECT_USER = `SELECT id, username, display_name, email, avatar, bio, role, status, verified, verify_token, verify_token_expires,
	password_hash, salt, created_at, updated_at, last_login_at, last_login_ip, login_count, class_name, grade_name, xp FROM users`;

export async function getUsers(): Promise<User[]> {
	await reconcileAdmin();
	const rows = await getDb().prepare(`${SELECT_USER} ORDER BY created_at ASC`).all() as unknown as UserRow[];
	return await Promise.all(rows.map(rowToUser));
}

/** 内置 admin 的口令以环境变量 ADMIN_PASSWORD 为权威来源（沿用旧行为）。 */
let adminReconciled = false;
async function reconcileAdmin() {
	if (adminReconciled) return;
	adminReconciled = true;
	const envPw = process.env.ADMIN_PASSWORD;
	if (!envPw) return;
	const db = getDb();
	const admin = await db.prepare(`${SELECT_USER} WHERE username = 'admin'`).get() as unknown as UserRow | undefined;
	if (!admin) return;
	const expected = hashPassword(envPw, admin.salt);
	if (expected !== admin.password_hash) {
		await db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE username = 'admin'").run(expected, nowIso());
	}
}

export async function getUser(username: string): Promise<User | null> {
	const row = await getDb().prepare(`${SELECT_USER} WHERE username = ?`).get(username) as unknown as UserRow | undefined;
	return row ? await rowToUser(row) : null;
}

/** 按数据库主键取用户（OAuth token 端点用）。 */
export async function getUserById(id: number): Promise<User | null> {
	if (id == null || Number.isNaN(id)) return null;
	const row = await getDb().prepare(`${SELECT_USER} WHERE id = ?`).get(id) as unknown as UserRow | undefined;
	return row ? await rowToUser(row) : null;
}

/**
 * 按「用户名 / 邮箱」识别用户，2026-10-04 起全链路共用（登录 + 重发验证）。
 * 识别顺序：精确用户名 → 忽略大小写的用户名 → 忽略大小写的邮箱。
 * ⚠️ 歧义防线：模糊查询（忽略大小写 / 邮箱）**只允许恰中一条**；命多条 = 重名或
 *    重复邮箱，返回 null（fail-closed）—— 宁可让用户用精确用户名，也不能登错账号。
 *    这条防线**必须**和注册端的大小写查重配套（注册禁止产生 WuMengAA/wumengaa 并存）。
 */
async function findUserByIdentifier(identifier: string): Promise<User | null> {
	const exact = await getUser(identifier);
	if (exact) return exact;
	const nameRows = await getDb()
		.prepare(`${SELECT_USER} WHERE lower(username) = lower(?)`)
		.all(identifier) as unknown as UserRow[];
	if (nameRows.length === 1) return await rowToUser(nameRows[0]);
	const mailRows = await getDb()
		.prepare(`${SELECT_USER} WHERE lower(email) = lower(?)`)
		.all(identifier) as unknown as UserRow[];
	if (mailRows.length === 1) return await rowToUser(mailRows[0]);
	return null;
}

export async function verifyLogin(identifier: string, password: string): Promise<User | null> {
	// 2026-10-04：识别放宽为「精确用户名 → 忽略大小写的用户名 → 邮箱」三连查，
	// 修 WuMengAA 这类大小写账号：填 wumengaa / 2498517208@qq.com 都该能登录。
	// 歧义防线见 findUserByIdentifier —— 模糊查询命中多条时拒绝，绝不静默二选一。
	const user = await findUserByIdentifier(identifier);
	if (!user) return null;
	const hash = hashPassword(password, user.salt);
	if (hash !== user.passwordHash) return null;
	if (user.status !== "active") return null; // 停用 / 待验证均不可登录
	return user;
}

export async function createUser(
	username: string,
	password: string,
	displayName: string,
	role: Role = "editor",
	extra: { email?: string; bio?: string } = {}
): Promise<{ ok: boolean; error?: string }> {
	const name = username.trim();
	if (!name || !password || password.length < 6) {
		return { ok: false, error: "用户名不能为空，密码至少 6 位" };
	}
	if (await getUser(name)) {
		return { ok: false, error: "用户名已存在" };
	}
	const salt = crypto.randomBytes(16).toString("hex");
	const ts = nowIso();
	await getDb()
		.prepare(
			`INSERT INTO users (username, display_name, email, avatar, bio, role, status, verified, password_hash, salt, created_at, updated_at, login_count)
			 VALUES (?, ?, ?, '', ?, ?, 'active', 1, ?, ?, ?, ?, 0)`
		)
		.run(name, displayName.trim() || name, extra.email?.trim() || "", extra.bio?.trim() || "", role, hashPassword(password, salt), salt, ts, ts);
	return { ok: true };
}

/** 按邮箱查重（仅返回是否存在，不泄露明细）。 */
export async function isEmailTaken(email: string): Promise<boolean> {
	if (!email) return false;
	const row = await getDb().prepare("SELECT id FROM users WHERE email = ?").get(email);
	return !!row;
}

/** 按邮箱取用户（用于重发验证）。 */
export async function getUserByEmail(email: string): Promise<User | null> {
	if (!email) return null;
	const row = await getDb().prepare(`${SELECT_USER} WHERE email = ?`).get(email) as unknown as UserRow | undefined;
	return row ? await rowToUser(row) : null;
}

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * 注册白名单（环境变量开启；为空数组 = 关闭，保持开放注册）：
 *   REGISTER_EMAIL_DOMAINS=example.edu.cn,school.cn  → 仅允许这些邮箱域名
 *   REGISTER_INVITE_CODES=abc123,xyz789             → 必须携带匹配邀请码
 */
const REGISTER_EMAIL_DOMAINS = (process.env.REGISTER_EMAIL_DOMAINS || "")
	.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const REGISTER_INVITE_CODES = (process.env.REGISTER_INVITE_CODES || "")
	.split(",").map((s) => s.trim()).filter(Boolean);

/** 注册敏感词（社区合规底线；用户名 / 昵称命中即拒绝）。 */
const SENSITIVE_WORDS = [
	"fuck", "shit", "bitch", "asshole", "bastard", "damn", "sb", "nmsl",
	"色情", "涉黄", "裸聊", "约炮", "性爱", "自慰",
	"赌博", "博彩", "彩票群", "毒品", "吸毒", "枪支", "武器", "炸药",
	"诈骗", "洗钱", "走私", "贩毒", "代开发票", "办证", "法轮", "邪教",
	"骚货", "贱货", "傻逼", "草你", "日你"
];

// ── 密码策略（2026-09-27 安全网补强）────────────────────────────────────────
// 最小 12 位 + 禁常见弱密码；一处定义，注册/改密/重置共用。
const COMMON_WEAK_PASSWORDS = new Set([
	"123456", "123456789", "12345678", "1234567", "1234567890", "password",
	"password1", "password123", "123123", "111111", "000000", "qwerty",
	"qwerty123", "abc123", "admin", "admin123", "root", "root123", "test",
	"test123", "1234", "12345", "666666", "888888", "letmein", "welcome",
	"iloveyou", "123qwe", "11111111", "00000000", "a123456", "a123456789",
	"qq123456", "woaini", "woaini1314", "aini1314", "5201314", "1q2w3e4r",
	"1qaz2wsx", "zxcvbnm", "passw0rd", "admin888", "admin666", "gaoyuanyuan"
]);

/**
 * 校验密码强度。返回 null = 通过，否则返回中文错误。
 * 规则：≥12 位 + 不是常见弱密码 + 不含用户名（防"用户名当密码"）。
 */
export function validatePasswordStrength(password: string, username = ""): string | null {
	const pw = password || "";
	if (pw.length < 12) return "密码至少 12 位";
	if (COMMON_WEAK_PASSWORDS.has(pw.toLowerCase())) return "该密码过于常见，请换一个";
	const name = (username || "").trim().toLowerCase();
	if (name.length >= 4 && pw.toLowerCase().includes(name)) return "密码不能包含用户名";
	return null;
}

/**
 * 开放注册：创建「待验证」账号（status=pending）。
 * 默认角色 user，无需管理员介入；验证邮箱或管理员批准后方可登录。
 * 注册门槛（敏感词 / 邮箱域名白名单 / 邀请码）默认全关，由环境变量开启。
 *
 * ⚠️ 2026-10-04 安全修复：**只有邮件渠道可用（mailEnabled）时才回传 verifyToken**。
 *    此前无条件回传，而无 SMTP 的生产环境（本站当前就是）里 verifyToken 被当
 *    激活钥匙直接回给客户端 → 「注册即自激活」，任何人可批量注册有效账号。
 *    现在无邮件渠道时注册成功但账号保持 pending，需管理员在后台激活，杜绝自激活。
 */
export async function registerUser(
	username: string,
	email: string,
	password: string,
	displayName?: string,
	opts?: { inviteCode?: string }
): Promise<{ ok: boolean; error?: string; verifyToken?: string; username?: string; email?: string; mailAvailable?: boolean }> {
	const name = (username || "").trim();
	const mail = (email || "").trim();
	const nick = (displayName || "").trim();
	if (!name || !password) return { ok: false, error: "用户名和密码必填" };
	const pwErr = validatePasswordStrength(password, name);
	if (pwErr) return { ok: false, error: pwErr };
	if (!/^[a-zA-Z0-9_\u4e00-\u9fff]{2,20}$/.test(name)) {
		return { ok: false, error: "用户名 2-20 位，仅含字母 / 数字 / 下划线 / 汉字" };
	}
	if (mail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) {
		return { ok: false, error: "邮箱格式不正确" };
	}
	// 敏感词检测：用户名 / 昵称 命中即拒绝（社区合规）
	if (SENSITIVE_WORDS.some((w) => name.toLowerCase().includes(w) || (nick && nick.toLowerCase().includes(w)))) {
		return { ok: false, error: "用户名或昵称包含敏感词，请更换" };
	}
	// 邮箱域名白名单（开启时）：仅允许列表内的域名注册
	if (REGISTER_EMAIL_DOMAINS.length && (!mail || !REGISTER_EMAIL_DOMAINS.includes(mail.split("@")[1]?.toLowerCase() || ""))) {
		return { ok: false, error: "注册邮箱不在允许域名内" };
	}
	// 邀请码白名单（开启时）：必须携带匹配邀请码
	if (REGISTER_INVITE_CODES.length) {
		const code = (opts?.inviteCode || "").trim();
		if (!REGISTER_INVITE_CODES.includes(code)) return { ok: false, error: "需要有效的邀请码" };
	}
	// 2026-10-04：用户名/邮箱查重一律**忽略大小写**（lower 归一），
	// 否则已存在 WuMengAA 时还能再注册 wumengaa —— 登录识别放宽后就产生歧义（见 verifyLogin 注释）。
	// 邮箱同理：Foo@Bar.com 与 foo@bar.com 是同一个人家，不该各占一个号。
	const nameDup = await getDb()
		.prepare("SELECT id FROM users WHERE lower(username) = lower(?) LIMIT 1")
		.get(name);
	if (nameDup) return { ok: false, error: "用户名已存在" };
	if (mail) {
		const mailDup = await getDb()
			.prepare("SELECT id FROM users WHERE lower(email) = lower(?) LIMIT 1")
			.get(mail);
		if (mailDup) return { ok: false, error: "该邮箱已被注册" };
	}

	const salt = crypto.randomBytes(16).toString("hex");
	const token = crypto.randomBytes(32).toString("base64url");
	const ts = nowIso();
	const exp = new Date(Date.now() + VERIFY_TTL_MS).toISOString();
	await getDb()
		.prepare(
			`INSERT INTO users
			  (username, display_name, email, avatar, bio, role, status, verified, verify_token, verify_token_expires, password_hash, salt, created_at, updated_at, login_count)
			 VALUES (?, ?, ?, '', '', 'user', 'pending', 0, ?, ?, ?, ?, ?, ?, 0)`
		)
		.run(name, nick || name, mail, token, exp, hashPassword(password, salt), salt, ts, ts);
	// 邮件渠道可用时立即发验证邮件（未配置 SMTP 则静默跳过，前端回显链接兜底）
	const mailOk = mailEnabled();
	if (mail && mailOk) {
		await sendVerificationMail(mail, token).catch((e) => {
			console.error("[mailer] 注册验证邮件发送失败：", e);
		});
	}
	// 2026-10-04 安全修复：verifyToken 只在邮件渠道可用时才回传 —— 否则它等于
	// "注册即自激活"的钥匙（无 SMTP 时任何人注册都能立刻激活，批量造号）。
	// 无邮件渠道时账号保持 pending，由管理员在后台激活；前端据 mailAvailable 提示。
	return mailOk
		? { ok: true, verifyToken: token, username: name, email: mail }
		: { ok: true, verifyToken: "", username: name, email: mail, mailAvailable: false };
}

/** 发送注册验证邮件（内部：拼链接 + 调 sendMail）。 */
async function sendVerificationMail(email: string, token: string): Promise<void> {
	if (!mailEnabled()) return;
	const site = (env.PUBLIC_SITE_URL || "http://127.0.0.1:8090").replace(/\/$/, "");
	const url = site + "/verify?token=" + encodeURIComponent(token);
	await sendMail({
		to: email,
		subject: "星集控 · 请验证你的邮箱",
		text: "欢迎注册星集控！\n\n点击以下链接完成邮箱验证（24 小时内有效）：\n" + url,
		html:
			"<p>欢迎注册星集控！</p><p>点击下方按钮完成邮箱验证（24 小时内有效）：</p>" +
			'<p><a href="' + url + '" style="display:inline-block;padding:10px 20px;background:#534AB7;color:#fff;text-decoration:none;border-radius:6px">验证邮箱</a></p>' +
			'<p style="color:#888;font-size:12px">无法点击？复制此链接：<br/>' + url + '</p>',
	});
}

/** 消费验证令牌：激活账号（status=active, verified=1）。 */
export async function verifyEmail(token: string): Promise<{ ok: boolean; error?: string }> {
	if (!token) return { ok: false, error: "缺少验证令牌" };
	const db = getDb();
	const row = await db.prepare("SELECT id, status, verify_token_expires FROM users WHERE verify_token = ?").get(token) as
		| { id: number; status: string; verify_token_expires: string }
		| undefined;
	if (!row) return { ok: false, error: "验证链接无效或已使用" };
	if (row.status !== "pending") return { ok: false, error: "账号已激活" };
	const exp = Date.parse(row.verify_token_expires || "");
	if (!Number.isFinite(exp) || exp < Date.now()) {
		return { ok: false, error: "验证链接已过期，请重新获取" };
	}
	await db.prepare("UPDATE users SET status = 'active', verified = 1, verify_token = '', verify_token_expires = '', updated_at = ? WHERE id = ?").run(
		nowIso(),
		row.id
	);
	return { ok: true };
}

/** 重发验证令牌（按用户名或邮箱；复用同一套歧义安全识别，见 findUserByIdentifier）。
 * 2026-10-04 安全修复：与 registerUser 同规 —— 只有邮件渠道可用（mailEnabled）才回传
 * verifyToken；无 SMTP 时绝不把激活令牌交给客户端（否则 resend 就是第二条自激活通道）。 */
export async function resendVerification(identifier: string): Promise<{ ok: boolean; error?: string; verifyToken?: string; email?: string; mailAvailable?: boolean }> {
	const user = await findUserByIdentifier(identifier || "");
	if (!user) return { ok: false, error: "账号不存在" };
	if (user.status === "active" && user.verified) return { ok: false, error: "账号已激活" };
	const mailOk = mailEnabled();
	const token = crypto.randomBytes(32).toString("base64url");
	const exp = new Date(Date.now() + VERIFY_TTL_MS).toISOString();
	await getDb()
		.prepare("UPDATE users SET verify_token = ?, verify_token_expires = ?, updated_at = ? WHERE id = ?")
		.run(token, exp, nowIso(), user.id ?? -1);
	if (user.email && mailOk) {
		await sendVerificationMail(user.email, token).catch((e) => {
			console.error("[mailer] 重发验证邮件失败：", e);
		});
	}
	return mailOk
		? { ok: true, verifyToken: token, email: user.email, mailAvailable: true }
		: { ok: true, verifyToken: "", email: user.email, mailAvailable: false };
}

export async function deleteUser(username: string): Promise<{ ok: boolean; error?: string }> {
	if (username === "admin") {
		return { ok: false, error: "不能删除内置管理员" };
	}
	const user = await getUser(username);
	if (!user) {
		return { ok: false, error: "用户不存在" };
	}
	const db = getDb();
	await db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id ?? -1);
	await db.prepare("DELETE FROM users WHERE id = ?").run(user.id ?? -1);
	return { ok: true };
}

export async function changePassword(username: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
	const pwErr = validatePasswordStrength(newPassword, username);
	if (pwErr) return { ok: false, error: pwErr };
	const user = await getUser(username);
	if (!user) return { ok: false, error: "用户不存在" };
	const salt = crypto.randomBytes(16).toString("hex");
	const db = getDb();
	await db.prepare("UPDATE users SET salt = ?, password_hash = ?, updated_at = ? WHERE id = ?").run(
		salt,
		hashPassword(newPassword, salt),
		nowIso(),
		user.id ?? -1
	);
	// 改密后吊销该用户全部会话（旧令牌立即失效）。
	await revokeSessions(username);
	return { ok: true };
}

/** 更新资料（本人可改：昵称 / 邮箱 / 简介 / 头像 / 显示名）。 */
export async function updateProfile(
	username: string,
	patch: { displayName?: string; email?: string; bio?: string; avatar?: string; className?: string; gradeName?: string }
): Promise<{ ok: boolean; error?: string }> {
	const user = await getUser(username);
	if (!user) return { ok: false, error: "用户不存在" };
	const db = getDb();
	await db.prepare(
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
export async function adminUpdateUser(
	username: string,
	patch: { displayName?: string; email?: string; bio?: string; role?: Role; status?: "active" | "disabled"; className?: string; gradeName?: string }
): Promise<{ ok: boolean; error?: string }> {
	const user = await getUser(username);
	if (!user) return { ok: false, error: "用户不存在" };
	if (username === "admin" && patch.role && patch.role !== "admin") {
		return { ok: false, error: "不能降级内置管理员" };
	}
	if (username === "admin" && patch.status === "disabled") {
		return { ok: false, error: "不能停用内置管理员" };
	}
	const db = getDb();
	await db.prepare(
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
	if (patch.status === "disabled") await revokeSessions(username);
	// 管理员批准（置 active）等价于完成验证。
	if (patch.status === "active") {
		await getDb().prepare("UPDATE users SET verified = 1 WHERE id = ?").run(user.id ?? -1);
	}
	return { ok: true };
}

/** 吊销某用户全部会话（不删账号）。 */
export async function revokeSessions(username: string): Promise<number> {
	const user = await getUser(username);
	if (!user) return 0;
	const info = await getDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id ?? -1);
	return Number(info.changes ?? 0);
}

// ── 会话令牌 ────────────────────────────────────────────────────────────────

export interface SessionMeta {
	ip?: string;
	userAgent?: string;
	/** 登录时限（天）：30 默认，可选 60 / 120；过期后需重新登录（2026-09-27 安全改造）。 */
	ttlDays?: number;
}

/** 建立登录会话，返回随机会话令牌。 */
export async function makeToken(user: User, meta: SessionMeta = {}): Promise<string> {
	const token = crypto.randomBytes(32).toString("base64url");
	const now = Date.now();
	const ttlDays = Math.min(Math.max(meta.ttlDays ?? 30, 1), 365);
	const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
	const db = getDb();
	await db.prepare(
		`INSERT INTO sessions (token, user_id, created_at, last_seen_at, expires_at, deadline, ip, user_agent)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
	).run(
		token,
		user.id ?? -1,
		new Date(now).toISOString(),
		new Date(now).toISOString(),
		new Date(now + ttlMs).toISOString(),
		new Date(now + ttlMs).toISOString(),
		(meta.ip || "").slice(0, 64),
		(meta.userAgent || "").slice(0, 300)
	);
	return token;
}

/** 记录一次成功登录（用于 last_login 与活动流）。 */
export async function markLogin(username: string, ip = ""): Promise<void> {
	const user = await getUser(username);
	if (!user) return;
	await getDb()
		.prepare("UPDATE users SET last_login_at = ?, last_login_ip = ?, login_count = login_count + 1 WHERE id = ?")
		.run(nowIso(), ip.slice(0, 64), user.id ?? -1);
}

/** 销毁单个会话（登出）。 */
export async function destroySession(token: string | undefined | null): Promise<void> {
	if (!token) return;
	try {
		await getDb().prepare("DELETE FROM sessions WHERE token = ?").run(token);
	} catch { /* noop */ }
}

/**
 * 头像取值规整 —— 与 oauth/userinfo 同标准的三段式清洗：
 *   1. 已是 http(s) 绝对地址 → 原样透出；
 *   2. 站内绝对路径（/uploads/... 等以 / 开头）→ 原样透出；
 *   3. 其余（历史脏值如 `avatar = "admin"`、裸文件名等）→ 返回空串。
 * 第 3 种刻意不给"原样透出"：客户端拿 "admin" 当 <img src> 会拼出
 * /admin 之类地址，那是个 HTML 页面而不是图片 —— 看上去像地址、实则是坏值，
 * 客户端无从分辨；给空串会让 UI 自然回落到默认头像/首字母 fallback。
 * 各消费方（后台侧栏账号卡、/api/me、oauth/userinfo）统一走本函数，避免
 * "同一种脏值三种处理"再次漂移。若调用方需要站内绝对路径补全站点域名
 * （如跨域 oauth 响应），由调用方自行对返回值的 "/..." 前缀拼接 base。
 */
export function sanitizeAvatar(raw: string | undefined | null): string {
	const v = (raw ?? "").trim();
	if (!v) return "";
	return /^https?:\/\//i.test(v) || v.startsWith("/") ? v : "";
}

/** 校验会话令牌 → 用户；命中时滑动续期并节流刷新 last_seen。 */
/**
 * 校验会话令牌。可选传入当前 UA：与登录时记录的 UA 家族（浏览器+平台+主版本）
 * 不一致即吊销会话（2026-09-27 安全网补强：防令牌被盗后用异地浏览器/隐身窗口重放）。
 * 不传 ua 的调用点（后台各 route）行为不变，仅 hooks 主校验启用。
 */
// ── UA 家族签名（2026-09-27 安全网补强）────────────────────────────────────
// 只取「浏览器 + 平台 + 主版本号」，返回 null 表示无法识别（跳过检测）。
// 规则：Chrome/Edge/Firefox/Safari 家族 + Windows/Mac/Linux/Android/iOS + 主版本。
function uaFamily(ua: string): string | null {
	const platform =
		/android/i.test(ua) ? "android" :
		/iphone|ipad|ipod/i.test(ua) ? "ios" :
		/windows/i.test(ua) ? "win" :
		/mac os x|macintosh/i.test(ua) ? "mac" :
		/linux/i.test(ua) ? "linux" : "";
	const m = ua.match(/\b(Chrome|Firefox|Safari|Edg(?:e|\/)|OPR)\/(\d+)/i);
	if (!m) return null;
	let browser = m[1].toLowerCase().startsWith("edge") || m[1].toLowerCase().startsWith("edg")
		? "edge" : m[1].toLowerCase().replace("opr", "opera").replace("edg", "edge");
	if (browser === "safari" && /chrome/i.test(ua) && !/edg/i.test(ua) && !/opr/i.test(ua)) {
		browser = "chrome"; // Safari 的 UA 常含 Chrome 标记，Chrome 优先
	}
	return platform ? browser + "|" + platform + "|" + m[2] : browser + "|" + m[2];
}

export async function verifyToken(token: string | undefined | null, ua?: string | null): Promise<User | null> {
	if (!token) return null;
	try {
		const db = getDb();
		const row = await db
			.prepare(
				`SELECT s.last_seen_at AS s_seen, s.expires_at AS s_exp, s.deadline AS s_deadline, s.user_agent AS s_ua,
				        u.id, u.username, u.display_name, u.email, u.avatar, u.bio, u.role, u.status,
				        u.password_hash, u.salt, u.created_at, u.updated_at, u.last_login_at, u.last_login_ip, u.login_count,
				        u.class_name, u.grade_name, u.xp
				 FROM sessions s JOIN users u ON u.id = s.user_id
				 WHERE s.token = ?`
			)
			.get(token) as unknown as (UserRow & { s_seen: string; s_exp: string; s_ua: string }) | undefined;
		if (!row) return null;

		// ③ UA 突变检测：仅在"本次请求带 UA 且库里有记录"时启用；
		// 家族签名 = 浏览器 + 平台 + 主版本（小版本升级不算突变）。
		if (ua && row.s_ua) {
			const fam = uaFamily(ua);
			const storedFam = uaFamily(row.s_ua);
			if (fam && storedFam && fam !== storedFam) {
				await db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
				return null;
			}
		}

		const now = Date.now();
		const exp = Date.parse(row.s_exp);
		if (!Number.isFinite(exp) || exp < now) {
			await db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
			return null;
		}
		if (row.status === "disabled") return null;

		// 节流刷新 last_seen + 滑动续期（2026-09-27：cap 在登录时限 deadline，
		// 活跃会话也不会"永远不过期"——滑动的是"最近活跃"，总寿命上限不变）
		const seen = Date.parse(row.s_seen);
		if (!Number.isFinite(seen) || now - seen > SEEN_TOUCH_MS) {
			const deadline = Date.parse((row as unknown as { s_deadline?: string }).s_deadline ?? "");
			// 续期目标：now + TTL；若越过 deadline（老库无 deadline = 视为创建+30天，
			// 已由迁移回填），则收到 deadline 为止，避免静默延长总寿命。
			const nextExp = Number.isFinite(deadline)
				? Math.min(now + SESSION_TTL_MS, deadline)
				: now + SESSION_TTL_MS;
			await db.prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token = ?").run(
				new Date(now).toISOString(),
				new Date(nextExp).toISOString(),
				token
			);
		}
		return await rowToUser(row);
	} catch {
		return null;
	}
}
