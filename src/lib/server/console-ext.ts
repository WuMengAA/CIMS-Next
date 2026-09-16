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
	/** 目标班级（空数组 = 不限班级/全校）。用于「历史通知分班级」展示与筛选。 */
	classes: string[];
	/** 来源通道：notice（面板发布）/ chat（群里喊话）/ announcement（网站公告）。 */
	channel: string;
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

/** 班级列表 ↔ 存储串。存逗号分隔（便于 LIKE 粗筛），读回时还原成数组。 */
const packClasses = (v: unknown): string => {
	const list = Array.isArray(v) ? v : String(v ?? "").split(",");
	return list
		.map((x) => String(x).trim())
		.filter(Boolean)
		.slice(0, 40)
		.join(",")
		.slice(0, 800);
};
const unpackClasses = (s: unknown): string[] =>
	String(s ?? "")
		.split(",")
		.map((x) => x.trim())
		.filter(Boolean);

// ── 通知广播历史 ────────────────────────────────────────────────────────────

export function listNotices(limit = 50, classId?: string): ConsoleNotice[] {
	// 按班级筛选：班级号是逗号串里的独立项，用「首项 / 中间项 / 末项」三种包含式精确匹配，
	// 避免 LIKE '%3%' 把「13班」也匹配进来。空 classes 的旧行为「不限班级」，任何筛选都可见。
	const cls = String(classId ?? "").trim();
	const where = cls
		? "WHERE classes = '' OR classes = ? OR classes LIKE ? OR classes LIKE ? OR classes LIKE ?"
		: "";
	const params: any[] = cls ? [cls, `${cls},%`, `%,${cls},%`, `%,${cls}`] : [];
	const rows = getDb()
		.prepare(
			`SELECT id, title, scope, account, author, sent, classes, channel, created_at
			 FROM console_notices ${where} ORDER BY created_at DESC, id DESC LIMIT ?`
		)
		.all(...params, Math.min(Math.max(limit, 1), 200)) as unknown as any[];
	return rows.map((r) => ({
		id: r.id,
		title: r.title,
		scope: r.scope,
		account: r.account,
		author: r.author,
		sent: Number(r.sent ?? 0),
		classes: unpackClasses(r.classes),
		channel: r.channel || "",
		createdAt: r.created_at
	}));
}

export function addNotice(input: {
	title: string;
	scope?: string;
	account?: string;
	author?: string;
	sent?: number;
	classes?: string[] | string;
	channel?: string;
}): ConsoleNotice {
	const row = {
		title: cut(input.title, 200),
		scope: cut(input.scope || "本班", 32),
		account: cut(input.account, 64),
		author: cut(input.author, 64),
		sent: Number(input.sent ?? 0),
		classes: packClasses(input.classes),
		channel: cut(input.channel, 24)
	};
	const ts = nowIso();
	const info = getDb()
		.prepare(
			`INSERT INTO console_notices (title, scope, account, author, sent, classes, channel, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(row.title, row.scope, row.account, row.author, row.sent, row.classes, row.channel, ts);
	return {
		id: Number(info.lastInsertRowid),
		title: row.title,
		scope: row.scope,
		account: row.account,
		author: row.author,
		sent: row.sent,
		classes: unpackClasses(row.classes),
		channel: row.channel,
		createdAt: ts
	};
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

// ── 班级交流 · 好友 ──────────────────────────────────────────────────────────
//
// 语义约定：
//   · 关系是「无向」的（A 与 B 互为好友），但**请求**是有向的。
//   · `pair` 用两端 id 升序拼接做唯一键，于是 A→B 与 B→A 只会存在一行，
//     不会出现「两人互相申请、各存一条」的重复状态。
//   · 状态机：pending →（对方接受）accepted /（拒绝）rejected。
//     拒绝后原行保留为 rejected，再次申请时**复用该行**改回 pending，
//     而不是新插一行 —— 否则同一对人会攒出多条历史，列表页没法看。
//   · 所有函数都要求传入 `me`（当前登录用户 id），并在 SQL 层用它做约束：
//     绝不能凭前端传来的 id 随便改别人之间的关系。

export interface ConsoleFriend {
	id: number;
	/** 对端用户 id / 显示名（永远返回「对方」，调用方不需要自己判断方向）。 */
	peerId: number;
	peerName: string;
	/** pending（待我处理/待对方处理）/ accepted / rejected */
	status: string;
	/** true = 这条待处理请求是**我发出去的**（等对方回应），false = 别人发给我。 */
	outgoing: boolean;
	message: string;
	updatedAt: string;
}

const pairKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

/** 查询可添加的用户（按用户名/显示名/班级模糊匹配），排除自己。 */
export function searchUsers(
	meId: number,
	q: string,
	limit = 20
): { id: number; username: string; displayName: string; className: string; gradeName: string; role: string }[] {
	const kw = `%${String(q ?? "").trim()}%`;
	if (kw === "%%") return [];
	const rows = getDb()
		.prepare(
			`SELECT id, username, display_name, class_name, grade_name, role FROM users
			 WHERE id != ? AND status = 'active'
			   AND (username LIKE ? OR display_name LIKE ? OR class_name LIKE ?)
			 ORDER BY display_name LIMIT ?`
		)
		.all(meId, kw, kw, kw, Math.min(Math.max(limit, 1), 50)) as unknown as any[];
	return rows.map((r) => ({
		id: r.id,
		username: r.username,
		displayName: r.display_name || r.username,
		className: r.class_name || "",
		gradeName: r.grade_name || "",
		role: r.role || ""
	}));
}

/** 按 id 取一个用户的最小公开资料（校验对端存在性用；不返回邮箱等隐私字段）。 */
export function getUserBrief(
	id: number
): { id: number; username: string; displayName: string; className: string; gradeName: string } | null {
	if (!Number.isFinite(id) || id <= 0) return null;
	const r = getDb()
		.prepare(
			`SELECT id, username, display_name, class_name, grade_name FROM users
			 WHERE id = ? AND status = 'active'`
		)
		.get(id) as unknown as any;
	if (!r) return null;
	return {
		id: r.id,
		username: r.username,
		displayName: r.display_name || r.username,
		className: r.class_name || "",
		gradeName: r.grade_name || ""
	};
}

/** 我的好友关系（含待处理请求，双向都列）。 */
export function listFriends(meId: number): ConsoleFriend[] {
	const rows = getDb()
		.prepare(
			`SELECT id, requester_id, requester_name, addressee_id, addressee_name, status, message, updated_at
			 FROM console_friends
			 WHERE (requester_id = ? OR addressee_id = ?) AND status != 'rejected'
			 ORDER BY updated_at DESC, id DESC`
		)
		.all(meId, meId) as unknown as any[];
	return rows.map((r) => {
		const outgoing = r.requester_id === meId;
		return {
			id: r.id,
			peerId: outgoing ? r.addressee_id : r.requester_id,
			peerName: (outgoing ? r.addressee_name : r.requester_name) || String(outgoing ? r.addressee_id : r.requester_id),
			status: r.status,
			outgoing,
			message: r.message || "",
			updatedAt: r.updated_at
		};
	});
}

/** 发起好友申请（幂等：已存在关系时复用该行并回到 pending）。 */
export function requestFriend(
	me: { id: number; name: string },
	peerId: number,
	peerName: string,
	message = ""
): ConsoleFriend {
	const db = getDb();
	const pair = pairKey(me.id, peerId);
	const ts = nowIso();
	const exist = db.prepare("SELECT id, status FROM console_friends WHERE pair = ?").get(pair) as
		| { id: number; status: string }
		| undefined;
	if (exist) {
		// 已是好友就不重新申请（避免把 accepted 打回 pending）；
		// 被拒过则复用该行重新发起。
		if (exist.status === "accepted") {
			return listFriends(me.id).find((f) => f.peerId === peerId)!;
		}
		db.prepare("UPDATE console_friends SET status='pending', message=?, updated_at=? WHERE id=?")
			.run(cut(message, 200), ts, exist.id);
	} else {
		db.prepare(
			`INSERT INTO console_friends
			 (pair, requester_id, requester_name, addressee_id, addressee_name, status, message, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
		).run(pair, me.id, cut(me.name, 64), peerId, cut(peerName, 64), cut(message, 200), ts, ts);
	}
	return listFriends(me.id).find((f) => f.peerId === peerId)!;
}

/**
 * 回应好友申请。**只有收件人**能接受/拒绝 —— 这是权限要点：
 * SQL 的 WHERE 带 addressee_id = me，否则任何人都能替别人答应好友请求。
 */
export function respondFriend(meId: number, peerId: number, accept: boolean): boolean {
	const pair = pairKey(meId, peerId);
	const info = getDb()
		.prepare(
			`UPDATE console_friends SET status = ?, updated_at = ?
			 WHERE pair = ? AND addressee_id = ? AND status = 'pending'`
		)
		.run(accept ? "accepted" : "rejected", nowIso(), pair, meId);
	return Number(info.changes ?? 0) > 0;
}

/** 删除好友（或撤回自己发出的待处理申请）。两端任一都可删除。 */
export function removeFriend(meId: number, peerId: number): boolean {
	const info = getDb()
		.prepare("DELETE FROM console_friends WHERE pair = ? AND (requester_id = ? OR addressee_id = ?)")
		.run(pairKey(meId, peerId), meId, meId);
	return Number(info.changes ?? 0) > 0;
}

/** 我与某人是否为已接受的好友（私聊权限判定用）。 */
export function areFriends(meId: number, peerId: number): boolean {
	const row = getDb()
		.prepare("SELECT status FROM console_friends WHERE pair = ?")
		.get(pairKey(meId, peerId)) as { status: string } | undefined;
	return row?.status === "accepted";
}

/** 我作为某房间成员是否有权发言：一对一房间要求是好友，其余房间放行。 */
export function canTalkInRoom(meId: number, room: string): boolean {
	const m = /^dm:(\d+):(\d+)$/.exec(String(room || ""));
	if (!m) return true; // 群/班级房间由路由层按房间语义另外校验
	const a = Number(m[1]);
	const b = Number(m[2]);
	if (a !== meId && b !== meId) return false; // 不是这条会话的参与者
	const peer = a === meId ? b : a;
	return areFriends(meId, peer);
}
