/**
 * 集控面板（/admin/console）协作数据层。
 *
 * CIMS 后端不存储「通知历史 / 班级交流 / 操作日志」这类协作数据，
 * 此前集控面板在站点内嵌模式下这几块只能显示内置演示数据（看起来像坏了）。
 * 这里把它们落到站点自己的 SQLite（见 db.ts 的 console_* 三表），
 * 由 /api/console/ext/* 暴露给面板，实现真正的多用户协作与留痕。
 *
 * 边界：
 * - 通知**下发**仍走 CIMS 命令通道（设备侧），本层只负责「历史留痕」。
 * - 交流消息按 room 隔离：全局群 `techrep-global` + 各班级房间（room = classId）。
 * - 审计只记元数据，不存敏感内容。
 */
import { getDb, nowIso } from "./db.js";

export interface ConsoleNotice {
	id: number;
	title: string;
	scope: string;
	account: string;
	author: string;
	sent: number;
	createdAt: string;
}

export interface ConsoleChatMessage {
	id: number;
	room: string;
	sender: string;
	body: string;
	createdAt: string;
}

export interface ConsoleAuditEntry {
	id: number;
	actor: string;
	role: string;
	action: string;
	target: string;
	detail: string;
	createdAt: string;
}

/** 统一裁剪，防止超长内容撑爆库/页面。 */
const cut = (v: unknown, n: number) => String(v ?? "").slice(0, n);

// ── 通知广播历史 ────────────────────────────────────────────────────────────

export function listNotices(limit = 50): ConsoleNotice[] {
	const rows = getDb()
		.prepare(
			`SELECT id, title, scope, account, author, sent, created_at
			 FROM console_notices ORDER BY created_at DESC, id DESC LIMIT ?`
		)
		.all(Math.min(Math.max(limit, 1), 200)) as unknown as any[];
	return rows.map((r) => ({
		id: r.id,
		title: r.title,
		scope: r.scope,
		account: r.account,
		author: r.author,
		sent: Number(r.sent ?? 0),
		createdAt: r.created_at
	}));
}

export function addNotice(input: {
	title: string;
	scope?: string;
	account?: string;
	author?: string;
	sent?: number;
}): ConsoleNotice {
	const row = {
		title: cut(input.title, 200),
		scope: cut(input.scope || "本班", 32),
		account: cut(input.account, 64),
		author: cut(input.author, 64),
		sent: Number(input.sent ?? 0)
	};
	const ts = nowIso();
	const info = getDb()
		.prepare(
			`INSERT INTO console_notices (title, scope, account, author, sent, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`
		)
		.run(row.title, row.scope, row.account, row.author, row.sent, ts);
	return { id: Number(info.lastInsertRowid), ...row, createdAt: ts };
}

/** 清空通知历史（需 manageDevices 权限，由路由层把关）。 */
export function clearNotices(): number {
	const info = getDb().prepare("DELETE FROM console_notices").run();
	return Number(info.changes ?? 0);
}

// ── 班级交流 ────────────────────────────────────────────────────────────────

export function listChat(room = "techrep-global", limit = 100): ConsoleChatMessage[] {
	const rows = getDb()
		.prepare(
			`SELECT id, room, sender, body, created_at FROM console_chat
			 WHERE room = ? ORDER BY created_at DESC, id DESC LIMIT ?`
		)
		.all(cut(room, 64) || "techrep-global", Math.min(Math.max(limit, 1), 300)) as unknown as any[];
	// 页面按时间正序阅读，这里翻回正序返回
	return rows
		.map((r) => ({
			id: r.id,
			room: r.room,
			sender: r.sender,
			body: r.body,
			createdAt: r.created_at
		}))
		.reverse();
}

export function addChat(input: { room?: string; sender?: string; body: string }): ConsoleChatMessage {
	const row = {
		room: cut(input.room || "techrep-global", 64) || "techrep-global",
		sender: cut(input.sender, 64),
		body: cut(input.body, 1000)
	};
	const ts = nowIso();
	const info = getDb()
		.prepare(`INSERT INTO console_chat (room, sender, body, created_at) VALUES (?, ?, ?, ?)`)
		.run(row.room, row.sender, row.body, ts);
	return { id: Number(info.lastInsertRowid), ...row, createdAt: ts };
}

/** 各房间最新消息时间，用于未读角标（可选）。 */
export function chatRooms(): { room: string; count: number; lastAt: string }[] {
	const rows = getDb()
		.prepare(
			`SELECT room, COUNT(*) AS n, MAX(created_at) AS last FROM console_chat
			 GROUP BY room ORDER BY last DESC`
		)
		.all() as unknown as any[];
	return rows.map((r) => ({ room: r.room, count: Number(r.n ?? 0), lastAt: r.last }));
}

// ── 操作日志 ────────────────────────────────────────────────────────────────

export function listAudit(limit = 100, action?: string): ConsoleAuditEntry[] {
	const where = action ? "WHERE action = ?" : "";
	const params: any[] = action ? [cut(action, 64)] : [];
	const rows = getDb()
		.prepare(
			`SELECT id, actor, role, action, target, detail, created_at FROM console_audit
			 ${where} ORDER BY created_at DESC, id DESC LIMIT ?`
		)
		.all(...params, Math.min(Math.max(limit, 1), 300)) as unknown as any[];
	return rows.map((r) => ({
		id: r.id,
		actor: r.actor,
		role: r.role,
		action: r.action,
		target: r.target,
		detail: r.detail,
		createdAt: r.created_at
	}));
}

export function addAudit(input: {
	actor?: string;
	role?: string;
	action: string;
	target?: string;
	detail?: string;
}): ConsoleAuditEntry {
	const row = {
		actor: cut(input.actor, 64),
		role: cut(input.role, 32),
		action: cut(input.action, 64) || "unknown",
		target: cut(input.target, 200),
		detail: cut(input.detail, 500)
	};
	const ts = nowIso();
	const info = getDb()
		.prepare(
			`INSERT INTO console_audit (actor, role, action, target, detail, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`
		)
		.run(row.actor, row.role, row.action, row.target, row.detail, ts);
	return { id: Number(info.lastInsertRowid), ...row, createdAt: ts };
}

/** 面板首页用的汇总计数。 */
export function consoleSummary(): { notices: number; chatMessages: number; auditEntries: number; lastAuditAt: string | null } {
	const db = getDb();
	const n = (sql: string) => Number((db.prepare(sql).get() as { n: number } | undefined)?.n ?? 0);
	const last = db.prepare("SELECT MAX(created_at) AS t FROM console_audit").get() as { t: string | null } | undefined;
	return {
		notices: n("SELECT COUNT(*) AS n FROM console_notices"),
		chatMessages: n("SELECT COUNT(*) AS n FROM console_chat"),
		auditEntries: n("SELECT COUNT(*) AS n FROM console_audit"),
		lastAuditAt: last?.t ?? null
	};
}
