/**
 * 多用户活动流与在线状态。
 *
 * - `recordActivity` 写入 activities 表（附带内存级节流，避免高频页面浏览打爆写入）。
 * - `onlineUsers` 以 sessions.last_seen_at 为判据（默认 5 分钟内有心跳即视为在线），
 *   天然支持「同一账号多端在线」「多用户同时活动」。
 * - `listUsersOverview` 给后台用户管理页一次性返回「账号 + 在线 + 会话数 + 活动数」。
 */
import { getDb, nowIso } from "./db.js";

/** 在线判定窗口：5 分钟。 */
export const ONLINE_WINDOW_MS = 5 * 60 * 1000;
/** 活动写入节流窗口：同一用户 + 同一动作 + 同一目标，2 分钟内只记一条。 */
const ACTIVITY_THROTTLE_MS = 2 * 60 * 1000;

export type ActivityAction =
	| "login"
	| "logout"
	| "view"
	| "profile_update"
	| "user_create"
	| "user_update"
	| "user_delete"
	| "password_change"
	| "session_revoke"
	| "other";

export interface ActivityInput {
	userId?: number | null;
	username?: string;
	action: ActivityAction | string;
	target?: string;
	detail?: string;
	ip?: string;
	userAgent?: string;
}

export interface ActivityRow {
	id: number;
	user_id: number | null;
	username: string;
	action: string;
	target: string;
	detail: string;
	ip: string;
	user_agent: string;
	created_at: string;
}

// ── 写入节流（进程内） ──────────────────────────────────────────────────────
const throttleMap = new Map<string, number>();

function throttled(key: string): boolean {
	const now = Date.now();
	const last = throttleMap.get(key);
	if (last && now - last < ACTIVITY_THROTTLE_MS) return true;
	throttleMap.set(key, now);
	// 简单的容量保护，避免长期运行内存增长
	if (throttleMap.size > 5000) {
		for (const [k, t] of throttleMap) {
			if (now - t > ACTIVITY_THROTTLE_MS) throttleMap.delete(k);
		}
	}
	return false;
}

export function recordActivity(input: ActivityInput, opts: { throttle?: boolean } = {}): void {
	try {
		const target = (input.target || "").slice(0, 300);
		const key = `${input.userId ?? input.username ?? "-"}|${input.action}|${target}`;
		if (opts.throttle && throttled(key)) return;
		getDb()
			.prepare(
				`INSERT INTO activities (user_id, username, action, target, detail, ip, user_agent, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				input.userId ?? null,
				(input.username || "").slice(0, 64),
				String(input.action),
				target,
				(input.detail || "").slice(0, 1000),
				(input.ip || "").slice(0, 64),
				(input.userAgent || "").slice(0, 300),
				nowIso()
			);
	} catch { /* 活动记录失败不应影响主流程 */ }
}

export interface ActivityQuery {
	limit?: number;
	offset?: number;
	username?: string;
	action?: string;
	/** 只取某时间点之后（ISO）。 */
	since?: string;
}

export function listActivities(q: ActivityQuery = {}): { items: ActivityRow[]; total: number } {
	const db = getDb();
	const where: string[] = [];
	const params: any[] = [];
	if (q.username) {
		where.push("username = ?");
		params.push(q.username);
	}
	if (q.action) {
		where.push("action = ?");
		params.push(q.action);
	}
	if (q.since) {
		where.push("created_at >= ?");
		params.push(q.since);
	}
	const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

	const total = (db.prepare(`SELECT COUNT(*) AS n FROM activities ${clause}`).get(...params) as { n: number }).n;
	const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
	const offset = Math.max(q.offset ?? 0, 0);
	const items = db
		.prepare(`SELECT * FROM activities ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
		.all(...params, limit, offset) as unknown as ActivityRow[];
	return { items, total };
}

export interface OnlineUser {
	username: string;
	displayName: string;
	role: string;
	avatar: string;
	lastSeenAt: string;
	sessionCount: number;
	ips: string[];
}

/** 在线用户（按账号聚合多端会话）。 */
export function onlineUsers(windowMs = ONLINE_WINDOW_MS): OnlineUser[] {
	const since = new Date(Date.now() - windowMs).toISOString();
	const rows = getDb()
		.prepare(
			`SELECT u.username, u.display_name, u.role, u.avatar,
			        MAX(s.last_seen_at) AS last_seen, COUNT(*) AS session_count,
			        GROUP_CONCAT(DISTINCT s.ip) AS ips
			 FROM sessions s JOIN users u ON u.id = s.user_id
			 WHERE s.last_seen_at >= ?
			 GROUP BY u.id
			 ORDER BY last_seen DESC`
		)
		.all(since) as unknown as any[];
	return rows.map((r) => ({
		username: r.username,
		displayName: r.display_name || r.username,
		role: r.role,
		avatar: r.avatar || "",
		lastSeenAt: r.last_seen,
		sessionCount: Number(r.session_count ?? 1),
		ips: String(r.ips || "").split(",").filter(Boolean)
	}));
}

export interface UserOverview {
	username: string;
	displayName: string;
	email: string;
	avatar: string;
	bio: string;
	role: string;
	status: string;
	verified: boolean;
	createdAt: string;
	lastLoginAt: string | null;
	lastLoginIp: string | null;
	loginCount: number;
	sessionCount: number;
	lastSeenAt: string | null;
	online: boolean;
	activityCount: number;
}

/** 后台用户总览：账号 + 在线状态 + 会话数 + 活动数（一次查询聚合）。 */
export function listUsersOverview(): UserOverview[] {
	const now = Date.now();
	const rows = getDb()
		.prepare(
			`SELECT u.username, u.display_name, u.email, u.avatar, u.bio, u.role, u.status, u.verified,
			        u.created_at, u.last_login_at, u.last_login_ip, u.login_count,
			        (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) AS session_count,
			        (SELECT MAX(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at,
			        (SELECT COUNT(*) FROM activities a WHERE a.user_id = u.id) AS activity_count
			 FROM users u
			 ORDER BY u.created_at ASC`
		)
		.all() as unknown as any[];
	return rows.map((r) => {
		const seen = r.last_seen_at ? Date.parse(r.last_seen_at) : NaN;
		return {
			username: r.username,
			displayName: r.display_name || r.username,
			email: r.email || "",
			avatar: r.avatar || "",
			bio: r.bio || "",
			role: r.role,
			status: r.status,
			verified: !!r.verified,
			createdAt: r.created_at,
			lastLoginAt: r.last_login_at ?? null,
			lastLoginIp: r.last_login_ip ?? null,
			loginCount: Number(r.login_count ?? 0),
			sessionCount: Number(r.session_count ?? 0),
			lastSeenAt: r.last_seen_at ?? null,
			online: Number.isFinite(seen) && now - seen < ONLINE_WINDOW_MS,
			activityCount: Number(r.activity_count ?? 0)
		};
	});
}

/** 心跳：显式刷新会话 last_seen（前端定时调用，保证在线判定实时）。 */
export function touchPresence(token: string | undefined | null): boolean {
	if (!token) return false;
	try {
		const info = getDb()
			.prepare("UPDATE sessions SET last_seen_at = ? WHERE token = ?")
			.run(nowIso(), token);
		return Number(info.changes ?? 0) > 0;
	} catch {
		return false;
	}
}

/** 清理过期会话与过旧活动（可挂定时调用）。 */
export function prune(): { sessions: number; activities: number } {
	const db = getDb();
	const s = db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(nowIso());
	const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
	const a = db.prepare("DELETE FROM activities WHERE created_at < ?").run(cutoff);
	return { sessions: Number(s.changes ?? 0), activities: Number(a.changes ?? 0) };
}

export function activitySummary(): { total: number; today: number; activeUsers24h: number } {
	const db = getDb();
	const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
	const total = (db.prepare("SELECT COUNT(*) AS n FROM activities").get() as { n: number }).n;
	const today = (db.prepare("SELECT COUNT(*) AS n FROM activities WHERE created_at >= ?").get(dayAgo) as { n: number }).n;
	const activeUsers24h = (
		db.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM activities WHERE created_at >= ? AND user_id IS NOT NULL").get(dayAgo) as { n: number }
	).n;
	return { total, today, activeUsers24h };
}
