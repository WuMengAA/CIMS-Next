/**
 * 定时广播（2026-10-05 · 取代 CIMS scheduled-broadcast）。
 *
 * 站点自持：表 scheduled_broadcasts；到点由站点调度器扫描 → 复用自有 notify 通道
 * （broadcast.pushNotifyToDevice）向目标班级设备推大屏通知。三种类型：
 *   once（一次性：YYYY-MM-DD HH:MM）/ daily（每天 HH:MM）/ weekly（每周 weekday HH:MM）。
 */
import { getDb, nowIso } from "./db.js";

export type ScheduledBroadcast = {
	id: number;
	name: string;
	schedule_type: "once" | "daily" | "weekly";
	weekday: number | null;
	run_at: string;
	target_class_id: string;
	title: string;
	content: string;
	enabled: number;
	next_run_at: string;
	last_run_at: string;
	created_at: string;
	updated_at: string;
};

export type ScheduledInput = {
	name?: string;
	schedule_type?: string;
	weekday?: number | null;
	run_at?: string;
	target_class_id?: string;
	title?: string;
	content?: string;
	enabled?: boolean;
};

/** 列表（含停用，按 next_run 排序）。 */
export function listScheduledBroadcasts(): ScheduledBroadcast[] {
	return getDb()
		.prepare("SELECT * FROM scheduled_broadcasts ORDER BY next_run_at ASC, id DESC")
		.all() as ScheduledBroadcast[];
}

/** 计算 next_run_at（本地时区）。到点未执行会算到过去——调度器对 past 的 once 只补跑一次或跳过。 */
function computeNextRun(t: Pick<ScheduledBroadcast, "schedule_type" | "weekday" | "run_at" | "last_run_at">): string {
	const now = new Date();
	const run = String(t.run_at ?? "").trim();
	if (t.schedule_type === "once") {
		// run_at = "YYYY-MM-DD HH:MM"
		const d = new Date(run.replace(" ", "T"));
		return isNaN(d.getTime()) ? "" : d.toISOString();
	}
	// daily / weekly → 取 run_at 的 HH:MM
	const m = run.match(/(\d{1,2}):(\d{2})/);
	if (!m) return "";
	const hh = Number(m[1]);
	const mm = Number(m[2]);
	const next = new Date(now);
	next.setHours(hh, mm, 0, 0);
	if (t.schedule_type === "weekly" && t.weekday) {
		const target = (t.weekday % 7); // 周日=0
		let diff = (target - next.getDay() + 7) % 7;
		if (diff === 0 && next <= now) diff = 7; // 今天已过点 → 下周
		next.setDate(next.getDate() + diff);
	} else {
		if (next <= now) next.setDate(next.getDate() + 1); // 今天已过 → 明天
	}
	return next.toISOString();
}

/** 建/改（upsert by id=0 建，id>0 改）。返回完整行。 */
export function saveScheduledBroadcast(id: number, input: ScheduledInput): { ok: boolean; error?: string; item?: ScheduledBroadcast } {
	const type = String(input.schedule_type ?? "once");
	if (!["once", "daily", "weekly"].includes(type)) return { ok: false, error: "类型无效" };
	const runAt = String(input.run_at ?? "").trim();
	if (!runAt) return { ok: false, error: "缺少时间" };
	const ts = nowIso();
	try {
		const db = getDb();
		const base: Pick<ScheduledBroadcast, "schedule_type" | "weekday" | "run_at" | "last_run_at"> = {
			schedule_type: type as "once" | "daily" | "weekly",
			weekday: type === "weekly" ? Number(input.weekday) || null : null,
			run_at: runAt,
			last_run_at: ""
		};
		const nextRun = computeNextRun(base);
		if (id > 0) {
			db.prepare(
				`UPDATE scheduled_broadcasts SET name=?, schedule_type=?, weekday=?, run_at=?, target_class_id=?, title=?, content=?, enabled=?, next_run_at=?, updated_at=? WHERE id=?`
			).run(
				String(input.name ?? ""),
				type,
				base.weekday,
				runAt,
				String(input.target_class_id ?? ""),
				String(input.title ?? ""),
				String(input.content ?? ""),
				input.enabled === false ? 0 : 1,
				nextRun,
				ts,
				id
			);
		} else {
			db.prepare(
				`INSERT INTO scheduled_broadcasts (name, schedule_type, weekday, run_at, target_class_id, title, content, enabled, next_run_at, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			).run(
				String(input.name ?? ""),
				type,
				base.weekday,
				runAt,
				String(input.target_class_id ?? ""),
				String(input.title ?? ""),
				String(input.content ?? ""),
				input.enabled === false ? 0 : 1,
				nextRun,
				ts,
				ts
			);
		}
		const item = db
			.prepare("SELECT * FROM scheduled_broadcasts WHERE id = ?")
			.get(id > 0 ? id : (db.prepare("SELECT last_insert_rowid() AS r").get() as { r: number }).r) as ScheduledBroadcast;
		return { ok: true, item };
	} catch (err) {
		console.warn("[scheduled-broadcast] 保存失败：", err);
		return { ok: false, error: "保存失败（数据库错误）" };
	}
}

/** 启停。 */
export function toggleScheduledBroadcast(id: number, enabled: boolean): boolean {
	try {
		const info = getDb()
			.prepare("UPDATE scheduled_broadcasts SET enabled = ?, updated_at = ? WHERE id = ?")
			.run(enabled ? 1 : 0, nowIso(), id) as { changes?: number };
		return !!info?.changes;
	} catch {
		return false;
	}
}

/** 删除。 */
export function deleteScheduledBroadcast(id: number): boolean {
	try {
		const info = getDb().prepare("DELETE FROM scheduled_broadcasts WHERE id = ?").run(id) as { changes?: number };
		return !!info?.changes;
	} catch {
		return false;
	}
}

/** 调度器扫描：找出 next_run_at <= now 且 enabled 的条目。 */
export function dueScheduledBroadcasts(now = new Date()): ScheduledBroadcast[] {
	return getDb()
		.prepare("SELECT * FROM scheduled_broadcasts WHERE enabled = 1 AND next_run_at != '' AND next_run_at <= ?")
		.all(now.toISOString()) as ScheduledBroadcast[];
}

/** 标记已执行（更新 last_run_at + 重算 next_run；once 型直接禁用防重跑）。 */
export function markScheduledRun(id: number): void {
	try {
		const db = getDb();
		const it = db.prepare("SELECT * FROM scheduled_broadcasts WHERE id = ?").get(id) as ScheduledBroadcast | undefined;
		if (!it) return;
		const ts = nowIso();
		if (it.schedule_type === "once") {
			db.prepare("UPDATE scheduled_broadcasts SET enabled = 0, last_run_at = ?, updated_at = ? WHERE id = ?").run(ts, ts, id);
		} else {
			const next = computeNextRun({ schedule_type: it.schedule_type, weekday: it.weekday, run_at: it.run_at, last_run_at: ts });
			db.prepare("UPDATE scheduled_broadcasts SET last_run_at = ?, next_run_at = ?, updated_at = ? WHERE id = ?").run(ts, next, ts, id);
		}
	} catch (err) {
		console.warn("[scheduled-broadcast] 标记执行失败：", err);
	}
}