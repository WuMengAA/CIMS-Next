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
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CONTENT_DIR } from "./paths.js";
import { getDb, nowIso } from "./db.js";
import { resolveFeatures, featureDefaultsOf, FEATURE_KEYS, type FeatureKey, type Role } from "$lib/permissions.js";

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
	/** 通知类型（v2.1）：notice | island | popup | fullscreen（来自 notice_kinds，默认 notice）。 */
	type: string;
	/** 类型化旗标（JSON 原串；解析用 flagsParsed）。 */
	flags: string;
	flagsParsed: Record<string, unknown>;
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

export function listNotices(limit = 50, classId?: string, since?: string): ConsoleNotice[] {
	// 按班级筛选：班级号是逗号串里的独立项，用「首项 / 中间项 / 末项」三种包含式精确匹配，
	// 避免 LIKE '%3%' 把「13班」也匹配进来。空 classes 的旧行为「不限班级」，任何筛选都可见。
	const cls = String(classId ?? "").trim();
	const conds: string[] = [];
	const params: any[] = [];
	if (cls) {
		conds.push("(n.classes = '' OR n.classes = ? OR n.classes LIKE ? OR n.classes LIKE ? OR n.classes LIKE ?)");
		params.push(cls, `${cls},%`, `%,${cls},%`, `%,${cls}`);
	}
	// since：增量拉取（被控端 catch-up 与面板「只显示最近」都用它）。
	// 用 ISO 字典序比较（nowIso 为 UTC Z 格式），与 created_at 同一坐标系。
	const snc = String(since ?? "").trim();
	if (snc && !Number.isNaN(new Date(snc).getTime())) {
		conds.push("n.created_at > ?");
		params.push(new Date(snc).toISOString());
	}
	const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
	const rows = getDb()
		.prepare(
			`SELECT n.id, n.title, n.scope, n.account, n.author, n.sent, n.classes, n.channel, n.created_at,
			        k.type, k.flags
			 FROM console_notices n
			 LEFT JOIN notice_kinds k ON k.notice_id = n.id
			 ${where} ORDER BY n.created_at DESC, n.id DESC LIMIT ?`
		)
		.all(...params, Math.min(Math.max(limit, 1), 200)) as unknown as any[];
	return rows.map((r) => noticeFromRow(r));
}

export function noticeFromRow(r: any): ConsoleNotice {
	let flagsParsed: Record<string, unknown> = {};
	try {
		const f = JSON.parse(String(r.flags || "{}"));
		if (f && typeof f === "object") flagsParsed = f;
	} catch {
		/* 坏 JSON 当无旗标 */
	}
	return {
		id: Number(r.id),
		title: r.title,
		scope: r.scope,
		account: r.account,
		author: r.author,
		sent: Number(r.sent ?? 0),
		classes: unpackClasses(r.classes),
		channel: r.channel || "",
		type: String(r.type || "notice"),
		flags: String(r.flags || "{}"),
		flagsParsed,
		createdAt: r.created_at
	};
}

export function getNoticeById(id: number): ConsoleNotice | null {
	const r = getDb()
		.prepare(
			`SELECT n.id, n.title, n.scope, n.account, n.author, n.sent, n.classes, n.channel, n.created_at,
			        k.type, k.flags
			 FROM console_notices n
			 LEFT JOIN notice_kinds k ON k.notice_id = n.id
			 WHERE n.id = ?`
		)
		.get(Number(id ?? 0)) as any;
	return r ? noticeFromRow(r) : null;
}

export function addNotice(input: {
	title: string;
	scope?: string;
	account?: string;
	author?: string;
	sent?: number;
	classes?: string[] | string;
	channel?: string;
	/** v2.1 通知类型（notice/island/popup/fullscreen）；默认 notice。 */
	type?: string;
	/** 类型化旗标对象（emergency_confirm / auto_dismiss_seconds / reply_presets…）。 */
	flags?: Record<string, unknown>;
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
	const id = Number(info.lastInsertRowid);
	const kind = ["notice", "island", "popup", "fullscreen"].includes(String(input.type || "notice"))
		? String(input.type || "notice")
		: "notice";
	const flags = input.flags && typeof input.flags === "object" ? input.flags : {};
	if (kind !== "notice" || Object.keys(flags).length > 0) {
		getDb()
			.prepare(`INSERT INTO notice_kinds (notice_id, type, flags) VALUES (?, ?, ?)
			           ON CONFLICT(notice_id) DO UPDATE SET type = excluded.type, flags = excluded.flags`)
			.run(id, kind, JSON.stringify(flags).slice(0, 2000));
	}
	return {
		id,
		title: row.title,
		scope: row.scope,
		account: row.account,
		author: row.author,
		sent: row.sent,
		classes: unpackClasses(row.classes),
		channel: row.channel,
		type: kind,
		flags: JSON.stringify(flags),
		flagsParsed: flags,
		createdAt: ts
	};
}

/** 清空通知历史（需 manageDevices 权限，由路由层把关）。 */
export function clearNotices(): number {
	const info = getDb().prepare("DELETE FROM console_notices").run();
	return Number(info.changes ?? 0);
}

/** 回填送达数（类型化通知先建档拿 id、下发后再把 delivered 写回）。 */
export function setNoticeSent(id: number, sent: number): void {
	getDb()
		.prepare("UPDATE console_notices SET sent = ? WHERE id = ?")
		.run(Math.max(0, Number(sent ?? 0)), Number(id ?? 0));
}

// ── 通知送达回执（v2.1）─────────────────────────────────────────────────────

export interface NoticeDeliveryRow {
	id: number;
	notice_id: number;
	uid: string;
	state: string;
	action_result: string;
	/** 老师自由回复原文（replyNotice 上报；区别于预设短语 action_result）。 */
	reply: string;
	detail: string;
	created_at: string;
	updated_at: string;
}

/** 某条通知的逐台回执（面板「谁看了、谁没看」明细）。 */
export function listNoticeDeliveries(noticeId: number): NoticeDeliveryRow[] {
	return getDb()
		.prepare(
		`SELECT id, notice_id, uid, state, action_result, reply, detail, created_at, updated_at
		 FROM notice_deliveries WHERE notice_id = ? ORDER BY created_at ASC`
	)
		.all(Number(noticeId ?? 0)) as unknown as NoticeDeliveryRow[];
}

/** 建档：某通知开局时给每台目标设备落一行 pending（幂等：已存在则跳过）。 */
export function ensureNoticeDeliveries(noticeId: number, uids: string[]): number {
	if (!Number(noticeId)) return 0;
	const ts = nowIso();
	let n = 0;
	const stmt = getDb().prepare(
		`INSERT OR IGNORE INTO notice_deliveries (notice_id, uid, state, action_result, reply, detail, created_at, updated_at)
		 VALUES (?, ?, 'pending', '', '', '', ?, ?)`
	);

	for (const uidRaw of uids) {
		const uid = String(uidRaw ?? "").trim().toLowerCase();
		if (!uid) continue;
		stmt.run(noticeId, uid, ts, ts);
		n++;
	}
	return n;
}

/**
 * 设备回报（设备密钥鉴权由路由层把关）：received → read / replied / rejected / dismissed。
 * action_result 只用于 replied（预设短语原文）；其余状态置空。
 * 返回是否命中（找不到行 = 通知不存在或不是发往这台设备的，拒绝）。
 */
export function markNoticeDelivery(
	noticeId: number,
	uid: string,
	state: string,
	actionResult: string
): boolean {
	const nid = Number(noticeId ?? 0);
	const u = String(uid ?? "").trim().toLowerCase();
	if (!nid || !u) return false;
	const st = ["received", "read", "replied", "rejected", "dismissed", "failed"].includes(state)
		? state
		: "read";
	// replied 允许带预设短语原文；其余状态一律不存（防脏数据）
	const ar = st === "replied" ? String(actionResult ?? "").slice(0, 120) : "";
	const r = getDb()
		.prepare(
			`UPDATE notice_deliveries
			 SET state = ?, action_result = ?, updated_at = ?
			 WHERE notice_id = ? AND LOWER(uid) = ? AND state NOT IN ('replied', 'acked')`
		)
		.run(st, ar, nowIso(), nid, u);
	return Number(r.changes) > 0;
}

/**
 * 被控端 catch-up 拉取：某台设备还没看到的类型化通知（用于「错过弹窗/重启后补齐」）。
 * 返回该设备仍为 pending/received（未终态）的通知。plain notice 不在此列（无交互语义）。
 */
export function listPendingTypedNotices(
	uid: string,
	limit = 20,
	sinceId = 0
): ConsoleNotice[] {
	const u = String(uid ?? "").trim().toLowerCase();
	if (!u) return [];
	const rows = getDb()
		.prepare(
			`SELECT n.id, n.title, n.scope, n.account, n.author, n.sent, n.classes, n.channel, n.created_at,
			        k.type, k.flags
			 FROM notice_deliveries d
			 JOIN console_notices n ON n.id = d.notice_id
			 JOIN notice_kinds k ON k.notice_id = n.id
			 WHERE LOWER(d.uid) = ? AND d.state = 'pending' AND d.notice_id > ?
			 ORDER BY d.notice_id ASC
			 LIMIT ?`
		)
		.all(u, Number(sinceId) || 0, Math.min(Math.max(limit, 1), 50)) as unknown as any[];
	return rows.map((r) => noticeFromRow(r));
}

/**
 * 带游标的 catch-up（2026-09-26）：一次拉不完就分页，客户端下次带 `cursor` 接着来。
 *
 * 为什么不能只靠「60 秒节流 + 取前 20 条」：通知批量下发时一次塞不下的那些
 * 会在下一轮被重新取到（因为仍是 pending），于是同一条被弹两次；而漏掉的
 * 那条永远排在 20 名之外，机器重启后照样错过。游标（已处理到的最大 notice_id）
 * 让「拉到哪了」变成可持久化的进度，幂等才有落点。
 */
export function listPendingTypedNoticesPage(
	uid: string,
	sinceId = 0,
	limit = 20
): { notices: ConsoleNotice[]; cursor: number } {
	const list = listPendingTypedNotices(uid, limit, sinceId);
	const cursor = list.reduce((m, n) => (n.id > m ? n.id : m), Number(sinceId) || 0);
	return { notices: list, cursor };
}

/**
 * 消息错过提醒（2026-09-26）：这些通知发出去 [minutes] 分钟了，目标机器还是 pending
 * —— 也就是「它大概率没收到」。面板据此列出来，而不是让老师对着一片空白猜。
 *
 * 只报 pending：received/read 说明机器确实收到了；failed 有专门的错误路径。
 * 默认 10 分钟，短了会把「正在推的路上」误报成错过。
 */
export function listStaleDeliveries(
	minutes = 10,
	limit = 100
): { notice_id: number; uid: string; title: string; type: string; created_at: string }[] {
	const since = new Date(Date.now() - Math.max(1, minutes) * 60_000).toISOString();
	return getDb()
		.prepare(
			`SELECT d.notice_id, d.uid, n.title, COALESCE(k.type, 'notice') AS type, d.created_at
			 FROM notice_deliveries d
			 JOIN console_notices n ON n.id = d.notice_id
			 LEFT JOIN notice_kinds k ON k.notice_id = d.notice_id
			 WHERE d.state = 'pending' AND d.created_at <= ?
			 ORDER BY d.created_at ASC
			 LIMIT ?`
		)
		.all(since, Math.min(Math.max(limit, 1), 300)) as unknown as {
		notice_id: number;
		uid: string;
		title: string;
		type: string;
		created_at: string;
	}[];
}

/**
 * 设备侧回报「老师回复了」—— 双向传递的另一半。
 *
 * 只把 state 置 replied 是不够的：预设短语（action_result）和自由回复（reply）
 * 是两种东西。老师在弹窗里打了一整句话，面板若只显示预设列表，她会以为回复丢了。
 *
 * 与 markNoticeDelivery 的区别：这里**允许覆盖**已有回复（老师改口或重复提交时
 * 以最新为准），而 state 一旦终态（read/replied）就不再被回执改写 —— 否则
 * 「点过确认」会被后来的一句回覆抹掉，紧急通知的确认记录就不可信了。
 *
 * 返回是否命中（没这行 = 通知不存在 / 不是发往这台设备的，拒绝）。
 */
export function markNoticeReply(noticeId: number, uid: string, text: string): boolean {
	const nid = Number(noticeId ?? 0);
	const u = String(uid ?? "").trim().toLowerCase();
	const t = cut(text, 500).trim();
	if (!nid || !u || !t) return false;
	const r = getDb()
		.prepare(
			`UPDATE notice_deliveries
			 SET reply = ?, state = 'replied', action_result = '', updated_at = ?
			 WHERE notice_id = ? AND LOWER(uid) = ?`
		)
		.run(t, nowIso(), nid, u);
	return Number(r.changes) > 0;
}

// ── 设备执行回执（被控端「动作做完之后」的上报）───────────────────────────────

export interface DeviceEventRow {
	id: number;
	uid: string;
	event: string;
	ok: number;
	detail: string;
	extra: string;
	created_at: string;
}

const DEVICE_EVENT_KEEP = 200;

/**
 * 记一条执行回执。ok=false **照样落库** —— 失败才是需要被看见的东西，
 * 只留成功的会让「哪台机器最近老是失败」从账面上彻底消失。
 */
export function addDeviceEvent(input: {
	uid: string;
	event: string;
	ok?: boolean;
	detail?: string;
	extra?: Record<string, unknown>;
	at?: string;
}): DeviceEventRow {
	const uid = cut(input.uid, 64).trim();
	const ev = cut(input.event, 64).trim();
	if (!uid || !ev) throw new Error("uid/event 不能为空");
	const ts = String(input.at ?? "").trim() || nowIso();
	let extraRaw = "";
	if (input.extra && typeof input.extra === "object") {
		try {
			extraRaw = JSON.stringify(input.extra).slice(0, 2000);
		} catch {
			extraRaw = "";
		}
	}
	const info = getDb()
		.prepare(
			`INSERT INTO device_events (uid, event, ok, detail, extra, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`
		)
		.run(uid, ev, input.ok === false ? 0 : 1, cut(input.detail, 400), extraRaw, ts);
	const id = Number(info.lastInsertRowid);
	pruneDeviceEvents(uid);
	return {
		id,
		uid,
		event: ev,
		ok: input.ok === false ? 0 : 1,
		detail: cut(input.detail, 400),
		extra: extraRaw,
		created_at: ts
	};
}

/** 取回执流水（按时间倒序）。uid 省略 = 全校（面板总览用，限 300 条）。 */
export function listDeviceEvents(uid?: string, limit = 100): DeviceEventRow[] {
	const n = Math.min(Math.max(limit, 1), 300);
	const u = String(uid ?? "").trim();
	const where = u ? "WHERE uid = ?" : "";
	const params: any[] = u ? [u] : [];
	return getDb()
		.prepare(`SELECT * FROM device_events ${where} ORDER BY created_at DESC, id DESC LIMIT ?`)
		.all(...params, n) as unknown as DeviceEventRow[];
}

/**
 * 每台设备只留最近的 [DEVICE_EVENT_KEEP] 条，其余按时间从老到新删。
 *
 * 不做保留期裁剪而只做条数裁剪，是有意的：老师问「上周三下午那台机器到底
 * 报了什么」时，按时间划线会正好划掉那一小时。条数裁剪只丢最新的记录，
 * 而最近 200 条覆盖了最近几天，够用；真要长期留档该走审计表，不该塞这里。
 */
export function pruneDeviceEvents(uid: string): number {
	const u = String(uid ?? "").trim();
	if (!u) return 0;
	return Number(
		getDb()
			.prepare(
				`DELETE FROM device_events
				  WHERE uid = ? AND id NOT IN (
					SELECT id FROM device_events WHERE uid = ? ORDER BY created_at DESC, id DESC LIMIT ?
				  )`
			)
			.run(u, u, DEVICE_EVENT_KEEP).changes ?? 0
	);
}

/** 面板「执行回执」页的计数条：这台机器最近多少成功、多少失败。 */
export function deviceEventStats(uid: string, sinceHours = 24): { total: number; ok: number; failed: number } {
	const u = String(uid ?? "").trim();
	if (!u) return { total: 0, ok: 0, failed: 0 };
	const since = new Date(Date.now() - Math.max(1, sinceHours) * 3600_000).toISOString();
	const r = getDb()
		.prepare(
			`SELECT COUNT(*) AS total, SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS ok
			 FROM device_events WHERE uid = ? AND created_at >= ?`
		)
		.get(u, since) as { total: number; ok: number | null } | undefined;
	const total = Number(r?.total ?? 0);
	const ok = Number(r?.ok ?? 0);
	return { total, ok, failed: total - ok };
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

/**
 * 审计链的哈希算法。
 *
 * 有无 `CONSOLE_AUDIT_KEY` 是两种安全档位，**不是可有可无的开关**：
 *   · 有（≥16 字符）→ HMAC-SHA256。攻击者即使能改库，没有密钥也造不出自洽的链。
 *   · 无            → 裸 SHA256。只能防「随手改一行」（改完得把后续全部重算），
 *                     懂行的人重写整条链仍可自洽 —— verify 的输出里会**如实标出**当前档位，
 *                     不让运维以为已经万无一失。
 * 这里不做「没配就自动生成并存库」的兜底：密钥存在同一个库里等于没加锁。
 */
const AUDIT_KEY = process.env.CONSOLE_AUDIT_KEY || "";
const AUDIT_KEYED = AUDIT_KEY.length >= 16;

/** 保留天数策略。未成年人影像/行为记录属合规敏感项，「留多久」必须是个明确的数字而非默认无限。 */
const AUDIT_RETENTION_DAYS = (() => {
	const n = Number(process.env.CONSOLE_AUDIT_RETENTION_DAYS ?? 180);
	return Number.isFinite(n) && n >= 7 ? Math.floor(n) : 180;
})();

/**
 * 行长什么样 → 哈希。字段顺序与分隔符都是**契约**：
 * 改动这里会让所有历史行的校验失败，所以刻意用 `\u0001`（正文里不可能出现的控制符）
 * 做分隔，避免「把两个字段拼起来恰好等于另外两个字段」的歧义碰撞。
 */
function auditRowHash(prevHash: string, r: { id: number; actor: string; role: string; action: string; target: string; detail: string; created_at: string }): string {
	const payload = [prevHash, r.id, r.actor, r.role, r.action, r.target, r.detail, r.created_at].join("\u0001");
	return AUDIT_KEYED
		? crypto.createHmac("sha256", AUDIT_KEY).update(payload).digest("hex")
		: crypto.createHash("sha256").update(payload).digest("hex");
}

function metaGet(key: string): string {
	const row = getDb().prepare("SELECT value FROM console_meta WHERE key = ?").get(key) as { value: string } | undefined;
	return row?.value ?? "";
}

function metaSet(key: string, value: string): void {
	getDb()
		.prepare("INSERT INTO console_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
		.run(key, value);
}

/** 面板「控制与媒体 / 实验特性」配置的存储键（复用 console_meta 这层 KV）。 */
const CONSOLE_SETTINGS_KEY = "console_settings";

/**
 * 允许通过面板写入的配置键白名单。
 *
 * 用白名单而不是「全量收下」：console_settings 是个开放 JSON 对象，若不限制键名，
 * 任何拿到 manage 权限的调用方都能往里塞任意键 —— 读取侧虽然只认已知键，
 * 但脏键会永久留在库里、且日后排查时没人记得它是干嘛的。
 */
export const CONSOLE_SETTINGS_KEYS = [
	// ── 远程控制 / VNC ──
	"novnc_url", // noVNC 页面地址
	"vnc_wait_seconds", // 下发指令后等待设备回报会话的秒数
	"vnc_require_token", // 是否要求会话级令牌
	// ── 媒体通道（摄像头抓拍 / 录像调取）──
	"media_mode", // p2p | relay | off —— 高带宽优先 P2P
	"media_ice_servers", // STUN/TURN，逗号分隔
	"media_snapshot_interval", // 抓拍间隔（秒）
	"media_retention_days", // 录像保留天数
	"media_max_bitrate_kbps", // 压缩目标码率
	"media_codec", // h264 | vp8 | av1
	"media_scale", // 画面最长边（像素）
	// ── 开发者 ──
	"dev_verbose", // 详细日志
	"dev_request_timeout_ms" // 请求超时（毫秒）
] as const;

/**
 * 读取面板持久化配置（控制 / 媒体 / 实验特性）。
 *
 * 为什么必须放服务端而不是 localStorage：这些值**决定教室端行为**（是否走 P2P、压缩目标、
 * 录像保留天数），必须全校一致；localStorage 是「每台电脑各存一份」—— 运维在 A 机改了，
 * B 机登录面板看到的还是旧值，两边下发的策略不一致，排查时会怀疑人生。
 */
export function getConsoleSettings(): Record<string, unknown> {
	const raw = metaGet(CONSOLE_SETTINGS_KEY);
	if (!raw) return {};
	try {
		const o = JSON.parse(raw);
		return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
	} catch {
		// 存坏了当空配置处理（不抛异常，免得把整个设置页连带打挂）
		return {};
	}
}

/**
 * 合并写入配置（PATCH 语义：只覆盖传入的键，其余保留）。
 * 显式传 `null` 的键会被删除，用于「恢复默认」。返回写入后的完整配置，便于前端立即回显。
 */
export function saveConsoleSettings(patch: Record<string, unknown>): Record<string, unknown> {
	const merged: Record<string, unknown> = { ...getConsoleSettings(), ...(patch || {}) };
	for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];
	metaSet(CONSOLE_SETTINGS_KEY, JSON.stringify(merged));
	return merged;
}

/**
 * 监控参数（截图/录像/远控编码）：从 console settings 取，缺省给默认值。
 * 设备端（Rust agent）经 GET /ext/monitor-config（设备密钥）拉取后应用。
 */
export function getMonitorConfig(): Record<string, unknown> {
	const s = getConsoleSettings();
	const num = (k: string, d: number) => {
		const v = Number(s[k]);
		return Number.isFinite(v) && v > 0 ? v : d;
	};
	return {
		screenshot_webp_quality: num("screenshot_webp_quality", 75),
		screenshot_max_width: num("screenshot_max_width", 1280),
		monitor_interval_sec: num("monitor_interval_sec", 0),
		monitor_retention_days: num("monitor_retention_days", 7),
		video_codec: String(s.video_codec ?? "vp9"),
		video_bitrate_kbps: num("video_bitrate_kbps", 600),
		video_fps: num("video_fps", 30),
		video_resolution: String(s.video_resolution ?? "1080p"),
		p2p_ice_override: String(s.p2p_ice_override ?? ""),
	};
}


/**
 * 设备接入码（2026-09-26 统一接入）：管理员生成，设备安装时输入激活码自拉配置。
 * 存 console_meta（单键 JSON 数组），每码绑定班级 + 有效期 + 已用标记。
 */
const ACTIVATE_KEY = "device_activation_codes";

export type ActivationCode = {
	code: string;
	classId: string;
	className: string;
	createdAt: string;
	expiresAt: string;
	used: boolean;
	usedBy?: string;
};

export function listActivationCodes(): ActivationCode[] {
	const raw = metaGet(ACTIVATE_KEY);
	if (!raw) return [];
	try {
		const a = JSON.parse(raw);
		return Array.isArray(a) ? (a as ActivationCode[]) : [];
	} catch { return []; }
}

function saveActivationCodes(list: ActivationCode[]): void {
	metaSet(ACTIVATE_KEY, JSON.stringify(list));
}

export function generateActivationCode(opts: { classId: string; className: string; hours: number }): ActivationCode {
	const code = "XJK-" + Math.random().toString(36).slice(2, 8).toUpperCase() + "-" + Math.random().toString(36).slice(2, 5).toUpperCase();
	const now = new Date();
	const item: ActivationCode = {
		code,
		classId: opts.classId,
		className: opts.className,
		createdAt: now.toISOString(),
		expiresAt: new Date(now.getTime() + opts.hours * 3600_000).toISOString(),
		used: false,
	};
	const list = listActivationCodes();
	list.unshift(item);
	saveActivationCodes(list.slice(0, 200)); // 只留最近 200 条
	return item;
}

export function revokeActivationCode(code: string): boolean {
	const list = listActivationCodes();
	const next = list.filter((c) => c.code !== code);
	if (next.length === list.length) return false;
	saveActivationCodes(next);
	return true;
}

export function consumeActivationCode(code: string, deviceUid: string): ActivationCode | null {
	const list = listActivationCodes();
	const idx = list.findIndex((c) => c.code === code.trim().toUpperCase() && !c.used);
	if (idx < 0) return null;
	const item = list[idx];
	if (new Date(item.expiresAt) < new Date()) return null; // 过期
	item.used = true;
	item.usedBy = deviceUid;
	list[idx] = item;
	saveActivationCodes(list);
	return item;
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
	const db = getDb();

	// 读链尾 → 插行 → 回填本行哈希 → 推进链尾：四步必须是一个整体。
	// 本函数全程**同步**（node:sqlite 的 DatabaseSync），单进程内不会被其它 JS 插队；
	// 但 SQLite 允许多进程连接，所以仍然显式开事务，防止第二个实例/命令行写入挤在中间，
	// 那会让两条记录拿到同一个 prev_hash —— 链就此分叉且**事后无法判定谁先谁后**。
	db.exec("BEGIN IMMEDIATE");
	try {
		const prev = metaGet("audit_head");
		const info = db
			.prepare(
				`INSERT INTO console_audit (actor, role, action, target, detail, created_at, prev_hash, row_hash)
				 VALUES (?, ?, ?, ?, ?, ?, ?, '')`
			)
			.run(row.actor, row.role, row.action, row.target, row.detail, ts, prev);
		const id = Number(info.lastInsertRowid);
		const hash = auditRowHash(prev, { id, ...row, created_at: ts });
		db.prepare("UPDATE console_audit SET row_hash = ? WHERE id = ?").run(hash, id);
		metaSet("audit_head", hash);
		db.exec("COMMIT");
		return { id, ...row, createdAt: ts };
	} catch (err) {
		try {
			db.exec("ROLLBACK");
		} catch {
			/* 已经回滚或根本没有活动事务，忽略 */
		}
		throw err;
	}
}

export interface AuditVerifyReport {
	ok: boolean;
	/** 实际校验过的行数（不含被跳过的历史遗留行）。 */
	checked: number;
	/** 本次迁移之前写入、没有哈希的行数 —— 它们无法校验，必须如实报出来。 */
	legacyRows: number;
	/** 第一处断裂的行 id；`null` 表示全链自洽。 */
	firstBadId: number | null;
	/** 断裂的具体原因（人话）。 */
	problem: string | null;
	/** 链尾是否与登记值一致（防止「把最后几条删掉」这种尾巴截断）。 */
	tailOk: boolean;
	/** 当前档位：hmac-sha256（有密钥）或 sha256（无密钥，弱）。 */
	mode: "hmac-sha256" | "sha256";
	/** 保留策略天数。 */
	retentionDays: number;
	/** 若历史被裁剪过，这里是被裁掉的时间点（便于解释「为什么早期记录不见了」）。 */
	prunedBefore: string | null;
}

/**
 * 走一遍哈希链，找第一处断裂。
 *
 * 设计取舍：**不**返回「整体可信/不可信」这种二值结论，而是返回「从第几行起可校验、
 * 第一处断在哪、为什么」。因为旧库迁移、裁剪保留期都会合法地产生「链不完整」，
 * 用一个 bool 表达会把「正常的历史裁剪」和「有人改了库」混为一谈 —— 那样报出来也没人信。
 */
export function verifyAudit(): AuditVerifyReport {
	const db = getDb();
	const anchor = metaGet("audit_anchor");
	const rows = db
		.prepare(
			`SELECT id, actor, role, action, target, detail, created_at, prev_hash, row_hash
			 FROM console_audit ORDER BY id ASC`
		)
		.all() as unknown as any[];

	let prev = anchor || "";
	let started = false;
	let checked = 0;
	let legacyRows = 0;
	let firstBadId: number | null = null;
	let problem: string | null = null;

	for (const r of rows) {
		if (!r.row_hash) {
			if (!started) {
				legacyRows++;
				continue;
			}
			firstBadId = r.id;
			problem = "链中间出现没有哈希的行（本行被插入或被清空了哈希）";
			break;
		}
		if (!started) {
			started = true;
			// 起点行必须接在锚点上：有锚点就必须对上，没锚点则必须是链首（空串）。
			const want = anchor || "";
			if (r.prev_hash !== want) {
				firstBadId = r.id;
				problem = anchor
					? "链的起点接不上裁剪锚点 —— 锚点之后的记录被替换或删除过"
					: "首行的 prev_hash 非空，但它前面没有任何被裁剪的记录";
				break;
			}
		} else if (r.prev_hash !== prev) {
			firstBadId = r.id;
			problem = "本行的 prev_hash 与上一行的 row_hash 不一致 —— 中间有行被删除或替换";
			break;
		}
		const h = auditRowHash(r.prev_hash, r);
		if (h !== r.row_hash) {
			firstBadId = r.id;
			problem = "本行内容与其登记的哈希不符 —— 该行被修改过";
			break;
		}
		prev = r.row_hash;
		checked++;
	}

	const head = metaGet("audit_head");
	// 空库时 head 与 prev 都是空串，视为一致；有 head 就必须等于链尾。
	const tailOk = !head ? checked === 0 : head === prev;
	if (tailOk === false && firstBadId === null) {
		problem = "链尾与登记的 head 不一致 —— 最后一条记录之后有内容被删除";
	}

	return {
		ok: firstBadId === null && tailOk,
		checked,
		legacyRows,
		firstBadId,
		problem,
		tailOk,
		mode: AUDIT_KEYED ? "hmac-sha256" : "sha256",
		retentionDays: AUDIT_RETENTION_DAYS,
		prunedBefore: metaGet("audit_pruned_before") || null
	};
}

/**
 * 按保留期裁剪审计（**只裁前缀**，保住链的连续性）。
 *
 * 两个容易做错的地方，这里刻意避开：
 *   ① 不能 `DELETE WHERE created_at < cutoff` 了事 —— 若时间戳与 id 不完全单调，
 *      删出来的是「中间挖洞」，链直接从洞断开。改为先取 `MAX(id)` 再按 `id <= m` 删，
 *      保证删掉的永远是**一段连续的前缀**。
 *   ② 删完必须把「被删的最后一行」的 row_hash 记成**锚点**，否则剩下的第一行
 *      prev_hash 会指向一个已经不存在的行，verify 立刻报断裂 —— 这会让人把
 *      「正常裁剪」误判成「有人篡改」，进而不再信任这个功能。
 */
export function pruneAudit(retentionDays = AUDIT_RETENTION_DAYS): {
	removed: number;
	anchor: string | null;
	prunedBefore: string | null;
	cutoff: string;
	/** 实际生效的保留天数（入参会被夹到 1~3650 的合理区间）。 */
	retentionDays: number;
} {
	const db = getDb();
	const days = Math.max(1, Math.min(Math.floor(retentionDays) || AUDIT_RETENTION_DAYS, 3650));
	const cutoff = new Date(Date.now() - days * 86400_000).toISOString();

	const last = db
		.prepare("SELECT id, row_hash, created_at FROM console_audit WHERE created_at < ? ORDER BY id DESC LIMIT 1")
		.get(cutoff) as { id: number; row_hash: string; created_at: string } | undefined;
	if (!last) return { removed: 0, anchor: null, prunedBefore: null, cutoff, retentionDays: days };

	const info = db.prepare("DELETE FROM console_audit WHERE id <= ?").run(last.id);
	const removed = Number(info.changes ?? 0);
	if (last.row_hash) metaSet("audit_anchor", last.row_hash);
	metaSet("audit_pruned_before", last.created_at);
	return { removed, anchor: last.row_hash || null, prunedBefore: last.created_at, cutoff, retentionDays: days };
}

/** 审计策略快照（供面板显示「当前保留多久、哪种档位」）。 */
export function auditPolicy(): { retentionDays: number; mode: "hmac-sha256" | "sha256"; anchored: boolean; prunedBefore: string | null } {
	return {
		retentionDays: AUDIT_RETENTION_DAYS,
		mode: AUDIT_KEYED ? "hmac-sha256" : "sha256",
		anchored: !!metaGet("audit_anchor"),
		prunedBefore: metaGet("audit_pruned_before") || null
	};
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

// ─────────────────────────────────────────────────────────────────────────────
// 设备会话登记（VNC / 媒体直连）
//
// 为什么必须真存：教室端的本地代理（stelarith-agent）起了 VNC 或媒体直连服务后，
// 会把 `{uid, ip, port, token}` 回报到扩展网关，面板再轮询取用。
// 旧实现在这两端都返回固定值（GET 恒 `{session:null}`、POST 只 `{ok:true}`）——
// 于是**代理报的会话被直接丢掉**，面板"永远等不到会话地址"。
// 那不是一个可以靠重试解决的问题，是链路里少了一环。
//
// 为什么放内存而不是 console_meta：
//   会话是**瞬时**的，且 IP/端口/令牌每次启动都变。若持久化，服务重启后
//   面板会拿到一条已经死掉的会话地址去连 —— 症状是"面板显示了地址但连不上"，
//   比"没有会话"更难排查。所以刻意不落库：进程重启 = 会话全部失效，
//   代理下一轮上报会重新登记。
// 另加 TTL 兜底：代理崩溃/断电来不及上报关闭时，会话不能永久留在内存里。
// ─────────────────────────────────────────────────────────────────────────────

export type DeviceSession = {
	uid: string;
	proto: string; // vnc | media
	ip: string;
	port: number;
	token: string;
	/** 登记时间（epoch ms） */
	at: number;
	/** 可选：媒体会话额外字段（如当前录像文件名、可用文件数） */
	extra?: Record<string, unknown>;
};

const SESSION_TTL_MS = Math.max(30, Number(process.env.CONSOLE_SESSION_TTL_SECONDS ?? 300)) * 1000;
const deviceSessions = new Map<string, DeviceSession>();

// ⚠️ uid 必须小写归一化（#T07.7 步骤 5 实测脱节）：教室端代理上报用的是
// `device_uid`（主机名，可能是小写 n7-20091211），而 CIMS 面板轮询用的是
// `client_id`（lab-pc-001）或 `host` 字段（大写 N7-20091211）——同一个设备的
// 两种写法如果不归一化，`vnc:${uid}` 就永远对不上，症状是「面板一直等待设备
// 回报会话地址」而 agent 其实早就报过了。与 captures 的 putDeviceCapture 同款
// 处理（那边也是 toLowerCase 后当 key）。
const sKey = (proto: string, uid: string) => `${proto}:${String(uid ?? "").trim().toLowerCase()}`;

/** 登记/覆盖一个设备会话，返回落库后的对象。uid 存小写（key 归一化，查询双 key 才能命中）。 */
export function putDeviceSession(
	input: Omit<DeviceSession, "at"> & { at?: number }
): DeviceSession {
	const uid = String(input.uid ?? "").trim().toLowerCase();
	const s: DeviceSession = { ...input, uid, at: input.at ?? Date.now() };
	deviceSessions.set(sKey(s.proto, s.uid), s);
	return s;
}

/** 取一个未过期的会话；过期即清掉并返回 null（顺带做惰性清理）。 */
export function getDeviceSession(proto: string, uid: string): DeviceSession | null {
	const k = sKey(proto, uid);
	const s = deviceSessions.get(k);
	if (!s) return null;
	if (Date.now() - s.at > SESSION_TTL_MS) {
		deviceSessions.delete(k);
		return null;
	}
	return s;
}

/** 主动注销（代理上报"已停止"时调用，别让面板拿到死地址）。 */
export function clearDeviceSession(proto: string, uid: string): boolean {
	return deviceSessions.delete(sKey(proto, uid));
}

/** 列出全部未过期会话（面板诊断页用：能看到"到底有没有人报过"）。 */
export function listDeviceSessions(proto?: string): DeviceSession[] {
	const now = Date.now();
	const alive: DeviceSession[] = [];
	for (const [k, s] of deviceSessions) {
		if (now - s.at > SESSION_TTL_MS) {
			deviceSessions.delete(k);
			continue;
		}
		if (!proto || s.proto === proto) alive.push(s);
	}
	return alive.sort((a, b) => b.at - a.at);
}

/**
 * 校验设备回报密钥（本地代理 → 网关）。
 *
 * 代理没有用户会话，走不了 viewConsole 那套鉴权；但它必须有权限登记会话，
 * 否则面板永远看不到教室端地址。用一枚部署级共享密钥：
 *   · 未配置 `CONSOLE_DEVICE_REPORT_SECRET` → **一律拒绝**（fail-closed）。
 *     这里绝不能"没配就放行"—— 那等于把"任意人可伪造教室端会话地址"这个洞
 *     留给一个默认配置缺失的场景，而面板会把伪造地址直接嵌进 iframe。
 */
export function verifyDeviceReportSecret(provided: string | null | undefined): boolean {
	const expect = (process.env.CONSOLE_DEVICE_REPORT_SECRET ?? "").trim();
	if (!expect) return false;
	const got = String(provided ?? "").trim();
	if (!got || got.length !== expect.length) return false;
	let diff = 0;
	for (let i = 0; i < expect.length; i++) diff |= expect.charCodeAt(i) ^ got.charCodeAt(i);
	return diff === 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// 设备截图回传（#T07.7 步骤 2）
//
// 教室端代理（stelarith-agent）截屏后把 PNG 回传到 ext 层，面板按 uid 轮询取图。
// 与 vnc/media 会话同类的「设备回执」：**瞬态**，每设备只保留最新一张，
// TTL 过期即丢 —— 截图是"看一眼当下屏幕"的瞬时操作，留档由教室端
// shots 目录负责（C:/ProgramData/Stelarith/shots），这里不做持久库。
// 图片字节落盘 content/captures/（运行时数据，gitignore 忽略），
// 内存索引只记元数据；面板 GET 时按需读回文件字节。
// ─────────────────────────────────────────────────────────────────────────────

export interface DeviceCaptureMeta {
	uid: string;
	/** 登记时间（epoch ms） */
	at: number;
	/** 图片字节数 */
	bytes: number;
	/** 落盘绝对路径 */
	path: string;
}

const CAPTURE_TTL_MS = Math.max(15, Number(process.env.CONSOLE_CAPTURE_TTL_SECONDS ?? 60)) * 1000;
const deviceCaptures = new Map<string, DeviceCaptureMeta>();

const CAPTURES_DIR = path.join(CONTENT_DIR, "captures");

/**
 * 截图就绪事件（v2.1）：每台设备的新截图登记后，这里留一条最近事件，
 * 操控端轮询「新截图」时能立刻知道"哪台设备有新图"，而不必逐台查。
 * 与截图本身同生命周期（内存 + 按 TTL 清理）：截图是瞬态回执，
 * 事件只是"有新的了"的提醒，图还是走 captures 端点取。
 */
export interface CaptureReadyEvent {
	uid: string;
	at: number;
}

const CAPTURE_EVENT_TTL_MS = Math.max(30, Number(process.env.CONSOLE_CAPTURE_EVENT_TTL_SECONDS ?? 120)) * 1000;
const captureReadyEvents: CaptureReadyEvent[] = [];

/** 登记一条"新截图就绪"事件（幂等：同设备 10 秒内只记一条，防轮询刷屏）。 */
export function notifyCaptureReady(uid: string): void {
	const key = String(uid ?? "").trim().toLowerCase();
	if (!key) return;
	const now = Date.now();
	const recent = captureReadyEvents.find((e) => e.uid === key);
	if (recent && now - recent.at < 10_000) return; // 10s 去重
	captureReadyEvents.push({ uid: key, at: now });
	// 只保留 TTL 内的
	while (captureReadyEvents.length > 0 && now - captureReadyEvents[0].at > CAPTURE_EVENT_TTL_MS) {
		captureReadyEvents.shift();
	}
}

/** 拉取最近的新截图就绪事件（按时间倒序）。 */
export function listCaptureReadyEvents(): CaptureReadyEvent[] {
	const now = Date.now();
	while (captureReadyEvents.length > 0 && now - captureReadyEvents[0].at > CAPTURE_EVENT_TTL_MS) {
		captureReadyEvents.shift();
	}
	return [...captureReadyEvents].sort((a, b) => b.at - a.at);
}


/** 登记一张设备截图（同设备覆盖旧图），返回元数据。uid 大小写不敏感（面板按 host 查时可能带大写）。 */
export function putDeviceCapture(uid: string, bytes: Buffer | Uint8Array): DeviceCaptureMeta {
	const key = String(uid ?? "").trim().toLowerCase();
	if (!key) throw new Error("uid 不能为空");
	if (!bytes || bytes.length === 0) throw new Error("图片字节为空");
	fs.mkdirSync(CAPTURES_DIR, { recursive: true });
	const p = (n: number) => String(n).padStart(2, "0");
	const d = new Date();
	const safe = key.replace(/[^A-Za-z0-9_.-]/g, "_");
	const name = `${safe}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
	const file = path.join(CAPTURES_DIR, name);
	fs.writeFileSync(file, bytes);
	const meta: DeviceCaptureMeta = { uid: key, at: Date.now(), bytes: bytes.length, path: file };
	deviceCaptures.set(key, meta);
	// v2.1：登记"新截图就绪"事件（操控端据此推送通知，而不是逐台轮询）
	notifyCaptureReady(key);
	// v2（监控回放）：除内存 TTL 缓存外，落一行 SQLite 索引（content/captures 的
	// 文件本身保留，「回放」= 按设备翻时间线）。旧路径只留最新一张 60s，
	// 老师想回看上午的教室画面时什么都没有 —— 这就是「监控视频回放」的落点。
	try {
		const sha = crypto.createHash("sha256").update(bytes).digest("hex");
		getDb()
			.prepare(
				`INSERT INTO captures (uid, path, bytes, sha256, created_at) VALUES (?, ?, ?, ?, ?)`
			)
			.run(key, file, bytes.length, sha, nowIso());
	} catch (e) {
		// 索引写失败不影响实时看图（主结果已落盘+内存）；记日志便于发现库异常。
		console.warn("[console-ext] captures 索引写入失败：", e);
	}
	return meta;
}

/** 回放时间线条目（不含图片字节；字节按 id 单独取，避免列表请求拖几十 MB）。 */
export interface CaptureHistoryItem {
	id: number;
	uid: string;
	at: string;
	bytes: number;
	sha256: string;
}

/** 某设备的截图历史（回放时间线，按时间倒序）。 */
export function listDeviceCaptures(uid: string, limit = 60): CaptureHistoryItem[] {
	const key = String(uid ?? "").trim().toLowerCase();
	if (!key) return [];
	const rows = getDb()
		.prepare(
			`SELECT id, uid, bytes, sha256, created_at FROM captures
			 WHERE uid = ? ORDER BY created_at DESC LIMIT ?`
		)
		.all(key, Math.min(Math.max(limit, 1), 300)) as {
		id: number;
		uid: string;
		bytes: number;
		sha256: string;
		created_at: string;
	}[];
	return rows.map((r) => ({
		id: r.id,
		uid: r.uid,
		at: r.created_at,
		bytes: r.bytes,
		sha256: r.sha256
	}));
}

/** 按行 id 取回放帧（含 PNG 字节）；文件已清理时返回 null。 */
export function getDeviceCaptureById(id: number): { meta: CaptureHistoryItem; png: Buffer } | null {
	if (!Number.isFinite(id) || id <= 0) return null;
	const row = getDb()
		.prepare(`SELECT id, uid, path, bytes, sha256, created_at FROM captures WHERE id = ?`)
		.get(id) as { id: number; uid: string; path: string; bytes: number; sha256: string; created_at: string } | undefined;
	if (!row) return null;
	try {
		const png = fs.readFileSync(row.path);
		if (png.length === 0) return null;
		return {
			meta: { id: row.id, uid: row.uid, at: row.created_at, bytes: row.bytes, sha256: row.sha256 },
			png
		};
	} catch {
		return null;
	}
}

/**
 * 取某设备最新截图（含 PNG 字节）。过期/文件丢失/空文件一律视为无截图并清索引。
 * 返回 `null` 表示「没有可用的截图」，与「设备没截过」等价 —— 面板据此展示
 * 等待提示而不是报错。
 */
export function getDeviceCapture(uid: string): { meta: DeviceCaptureMeta; png: Buffer } | null {
	const key = String(uid ?? "").trim().toLowerCase();
	if (!key) return null;
	const m = deviceCaptures.get(key);
	if (!m) return null;
	if (Date.now() - m.at > CAPTURE_TTL_MS) {
		deviceCaptures.delete(key);
		return null;
	}
	try {
		const png = fs.readFileSync(m.path);
		if (png.length === 0) {
			deviceCaptures.delete(key);
			return null;
		}
		return { meta: m, png };
	} catch {
		deviceCaptures.delete(key);
		return null;
	}
}

/** 主动清除某设备截图（面板取完图后可调，避免残留 TTL 窗口）。uid 大小写不敏感。 */
export function clearDeviceCapture(uid: string): boolean {
	const key = String(uid ?? "").trim().toLowerCase();
	if (!key) return false;
	const m = deviceCaptures.get(key);
	deviceCaptures.delete(key);
	if (m) {
		try {
			fs.unlinkSync(m.path);
		} catch {
			/* 文件可能已被外部清理，忽略 */
		}
	}
	return !!m;
}

// ── 功能开关（per-user 能力位）─────────────────────────────────────────────
//
// 「关键逻辑在服务端」的落点：角色只提供默认值，per-user 覆盖存在库里，
// 两者叠加后由 resolveUserFeatures 一次性算出结论下发给客户端。
// 客户端拿到的是结论（true/false），拿不到规则 —— 改前端开不出功能。

/** 读覆盖值。没记录 = 全按角色默认（不给每个人造空行）。 */
export function getUserFeatureOverrides(uid: string): Record<string, unknown> {
	const u = String(uid ?? "").trim();
	if (!u) return {};
	const r = getDb().prepare("SELECT flags FROM user_features WHERE uid = ?").get(u) as
		| { flags?: string }
		| undefined;
	if (!r?.flags) return {};
	try {
		const v = JSON.parse(r.flags);
		return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

/**
 * 写覆盖值：只认白名单功能位 + 布尔值，`null` = 恢复按角色默认，其余丢弃。
 * 不做白名单过滤的话，一个拼错的键会永远留在库里，谁都看不出它为什么没生效。
 */
export function setUserFeatureOverrides(
	uid: string,
	patch: Record<string, unknown>,
	actor: string
): Record<string, unknown> {
	const u = String(uid ?? "").trim();
	if (!u) return {};
	const next: Record<string, unknown> = { ...getUserFeatureOverrides(u) };
	const src = patch && typeof patch === "object" ? patch : {};
	for (const k of FEATURE_KEYS) {
		const v = (src as Record<string, unknown>)[k];
		if (v === true || v === false) next[k] = v;
		else if (v === null) delete next[k];
	}
	getDb()
		.prepare(
			`INSERT INTO user_features (uid, flags, updated_at, updated_by) VALUES (?, ?, ?, ?)
			 ON CONFLICT(uid) DO UPDATE SET flags = excluded.flags,
			                               updated_at = excluded.updated_at,
			                               updated_by = excluded.updated_by`
		)
		.run(u, JSON.stringify(next), nowIso(), cut(actor, 64));
	return next;
}

/** 最终能力位 —— 服务端唯一的裁决出口（面板/被控端都只能消费它）。 */
export function resolveUserFeatures(
	uid: string,
	role: Role | null | undefined
): { features: Record<FeatureKey, boolean>; overridden: FeatureKey[]; defaults: Record<FeatureKey, boolean> } {
	const { features, overridden } = resolveFeatures(role, getUserFeatureOverrides(uid));
	return { features, overridden, defaults: featureDefaultsOf(role) };
}

// ── 任务级回执（点击 → 结果，一对一）───────────────────────────────────────

export interface DeviceTaskRow {
	task_id: string;
	uid: string;
	kind: string;
	actor: string;
	state: string;
	result: string;
	extra: string;
	created_at: string;
	updated_at: string;
}

const TASK_KEEP = 300;

/**
 * 建档：操控端每次下发动作时开一张「任务单」，把 task_id 随指令下发给设备。
 * 设备做完之后带着同一个 task_id 回报 —— 这才是「被控端完成操作后给操控端
 * 上报响应」能落到某个按钮上的前提。
 */
export function createTask(input: {
	uid: string;
	kind: string;
	actor?: string;
	extra?: Record<string, unknown>;
}): DeviceTaskRow {
	const uid = cut(input.uid, 64).trim().toLowerCase();
	const kind = cut(input.kind, 32).trim();
	if (!uid || !kind) throw new Error("uid/kind 不能为空");
	const ts = nowIso();
	let extraRaw = "";
	if (input.extra && typeof input.extra === "object") {
		try {
			extraRaw = JSON.stringify(input.extra).slice(0, 1000);
		} catch {
			extraRaw = "";
		}
	}
	const id = crypto.randomUUID();
	getDb()
		.prepare(
			`INSERT INTO device_tasks (task_id, uid, kind, actor, state, result, extra, created_at, updated_at)
			 VALUES (?, ?, ?, ?, 'pending', '', ?, ?, ?)`
		)
		.run(id, uid, kind, cut(input.actor, 64), extraRaw, ts, ts);
	pruneTasks(uid);
	return {
		task_id: id,
		uid,
		kind,
		actor: cut(input.actor, 64),
		state: "pending",
		result: "",
		extra: extraRaw,
		created_at: ts,
		updated_at: ts
	};
}

/**
 * 设备回报结果。state 只允许 done / failed / timeout —— 越界一律当 failed，
 * 绝不让「上报了一个不认识的状态」偷偷把任务留在 pending（那会让面板永远转圈）。
 */
export function putTaskResult(
	taskId: string,
	state: string,
	result?: string,
	extra?: Record<string, unknown>
): DeviceTaskRow | null {
	const id = String(taskId ?? "").trim();
	if (!id) return null;
	const st = ["done", "failed", "timeout"].includes(state) ? state : "failed";
	let extraRaw = "";
	if (extra && typeof extra === "object") {
		try {
			extraRaw = JSON.stringify(extra).slice(0, 1000);
		} catch {
			extraRaw = "";
		}
	}
	const r = getDb()
		.prepare(
			`UPDATE device_tasks SET state = ?, result = ?, extra = CASE WHEN ? <> '' THEN ? ELSE extra END, updated_at = ?
			 WHERE task_id = ?`
		)
		.run(st, cut(result, 400), extraRaw, extraRaw, nowIso(), id);
	if (Number(r.changes) <= 0) return null;
	return getTask(id);
}

export function getTask(taskId: string): DeviceTaskRow | null {
	const r = getDb().prepare("SELECT * FROM device_tasks WHERE task_id = ?").get(String(taskId ?? "").trim()) as
		| DeviceTaskRow
		| undefined;
	return r ?? null;
}

/** 列任务（uid 省略 = 全校最近若干条，面板总览与排障用）。 */
export function listTasks(uid?: string, limit = 50): DeviceTaskRow[] {
	const n = Math.min(Math.max(limit, 1), 200);
	const u = String(uid ?? "").trim();
	const where = u ? "WHERE uid = ?" : "";
	const params: any[] = u ? [u] : [];
	return getDb()
		.prepare(`SELECT * FROM device_tasks ${where} ORDER BY created_at DESC, rowid DESC LIMIT ?`)
		.all(...params, n) as unknown as DeviceTaskRow[];
}

/**
 * 超时判死：挂了 [minutes] 分钟仍 pending 的任务一律置 timeout。
 * 没有这一步，一次网络抖动就会让按钮卡在「等待回执」上永远不落地 ——
 * 老师只会看到转圈，不会知道这次其实已经失败了。
 */
export function timeoutTasks(minutes = 5): number {
	const since = new Date(Date.now() - Math.max(1, minutes) * 60_000).toISOString();
	return Number(
		getDb()
			.prepare(
				`UPDATE device_tasks SET state = 'timeout', result = '设备未在 5 分钟内回执', updated_at = ?
				 WHERE state = 'pending' AND created_at <= ?`
			)
			.run(nowIso(), since).changes ?? 0
	);
}

/** 每台设备只留最近 [TASK_KEEP] 条，理由同 pruneDeviceEvents（按条数而非按时间）。 */
function pruneTasks(uid: string): void {
	const u = String(uid ?? "").trim();
	if (!u) return;
	getDb()
		.prepare(
			`DELETE FROM device_tasks
			  WHERE uid = ? AND rowid NOT IN (
				SELECT rowid FROM device_tasks WHERE uid = ? ORDER BY created_at DESC, rowid DESC LIMIT ?
			  )`
		)
		.run(u, u, TASK_KEEP);
}
