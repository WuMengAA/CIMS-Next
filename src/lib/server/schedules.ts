/**
 * 课表 + 调课（2026-10-05 · 定位 v2 落地：课表按班、作息全校共用；调课/换课是核心）。
 *
 * 取代 CIMS ClassPlan：教室端读课表从此读 class_schedules（自有表）。
 * 调课（换课）是含金量功能：申请 → 审批 → 生效，不直接改课表。
 * 生效 = 把「原节」的课程对调到「目标节」；目标节原内容挪回原节（两节互换）。
 */
import { getDb, nowIso } from "./db.js";

/* ── 作息（全校共用） ── */

export type TimetablePeriod = {
	id: number;
	school_id: string;
	period_no: number;
	name: string;
	start_time: string;
	end_time: string;
	sort_order: number;
	created_at: string;
};

/** 全校作息（节次表），按节次排序。school_id 默认 ''（单学校）。 */
export async function listTimetable(schoolId = ""): Promise<TimetablePeriod[]> {
	const s = String(schoolId ?? "").trim();
	return (
		(s
			? await getDb()
					.prepare("SELECT * FROM school_timetable WHERE school_id = ? ORDER BY sort_order ASC, period_no ASC")
					.all(s)
			: await getDb().prepare("SELECT * FROM school_timetable ORDER BY sort_order ASC, period_no ASC").all()) as TimetablePeriod[]
	);
}

/** 重建作息表（全量替换：先清后插，幂等）。school_id 默认 ''。 */
export async function replaceTimetable(periods: { period_no: number; name?: string; start_time?: string; end_time?: string }[], schoolId = ""): Promise<number> {
	const s = String(schoolId ?? "").trim();
	const db = getDb();
	await db.prepare("DELETE FROM school_timetable WHERE school_id = ?").run(s);
	let n = 0;
	for (const p of periods) {
		if (!p.period_no) continue;
		await db.prepare(
			"INSERT INTO school_timetable (school_id, period_no, name, start_time, end_time, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
		).run(s, p.period_no, String(p.name ?? `第${p.period_no}节`), String(p.start_time ?? ""), String(p.end_time ?? ""), p.period_no, nowIso());
		n++;
	}
	return n;
}

/* ── 课表（按班） ── */

export type ScheduleCell = {
	id: number;
	school_id: string;
	class_id: string;
	weekday: number;
	period_no: number;
	subject: string;
	teacher: string;
	remark: string;
	updated_at: string;
};

/** 某班课表（7×N 格子），无课格子返回空 cell（调用方显示空白）。 */
export async function listClassSchedule(classId: string, schoolId = ""): Promise<ScheduleCell[]> {
	const cid = String(classId ?? "").trim();
	if (!cid) return [];
	const s = String(schoolId ?? "").trim();
	return (
		(s
			? await getDb()
					.prepare("SELECT * FROM class_schedules WHERE class_id = ? AND school_id = ? ORDER BY weekday ASC, period_no ASC")
					.all(cid, s)
			: await getDb().prepare("SELECT * FROM class_schedules WHERE class_id = ? ORDER BY weekday ASC, period_no ASC").all(cid)) as ScheduleCell[]
	);
}

/** 写一格（upsert）。class_id/weekday/period_no 定位，subject/teacher/remark 覆盖。 */
export async function setScheduleCell(
	classId: string,
	weekday: number,
	periodNo: number,
	input: { subject?: string; teacher?: string; remark?: string },
	schoolId = ""
): Promise<boolean> {
	const cid = String(classId ?? "").trim();
	if (!cid || !weekday || !periodNo) return false;
	try {
		const db = getDb();
		const cur = await db
			.prepare("SELECT * FROM class_schedules WHERE class_id = ? AND weekday = ? AND period_no = ?")
			.get(cid, weekday, periodNo) as ScheduleCell | undefined;
		const s = String(schoolId ?? "").trim();
		if (cur) {
			await db.prepare(
				"UPDATE class_schedules SET subject = ?, teacher = ?, remark = ?, updated_at = ? WHERE class_id = ? AND weekday = ? AND period_no = ?"
			).run(
				String(input.subject ?? cur.subject),
				String(input.teacher ?? cur.teacher),
				String(input.remark ?? cur.remark),
				nowIso(),
				cid,
				weekday,
				periodNo
			);
		} else {
			await db.prepare(
				"INSERT INTO class_schedules (school_id, class_id, weekday, period_no, subject, teacher, remark, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
			).run(s, cid, weekday, periodNo, String(input.subject ?? ""), String(input.teacher ?? ""), String(input.remark ?? ""), nowIso());
		}
		return true;
	} catch (err) {
		console.warn("[schedules] 写课表失败：", err);
		return false;
	}
}

/** 清一格（删课）。 */
export async function clearScheduleCell(classId: string, weekday: number, periodNo: number): Promise<boolean> {
	try {
		const info = await getDb()
			.prepare("DELETE FROM class_schedules WHERE class_id = ? AND weekday = ? AND period_no = ?")
			.run(String(classId ?? ""), weekday, periodNo) as { changes?: number };
		return !!info?.changes;
	} catch {
		return false;
	}
}

/* ── 调课（换课，含金量） ── */

export type ScheduleSwap = {
	id: number;
	school_id: string;
	class_id: string;
	from_weekday: number;
	from_period: number;
	to_weekday: number;
	to_period: number;
	reason: string;
	requested_by: string;
	status: "pending" | "approved" | "rejected" | "applied";
	reviewed_by: string;
	created_at: string;
	updated_at: string;
};

export type SwapCreateInput = {
	classId: string;
	fromWeekday: number;
	fromPeriod: number;
	toWeekday: number;
	toPeriod: number;
	reason?: string;
	requestedBy: string;
	schoolId?: string;
};

/** 提交调课申请。校验：原节和目标节都在课表里、不是同一格、不重复 pending。 */
export async function createSwapRequest(input: SwapCreateInput): Promise<{ ok: boolean; error?: string; swap?: ScheduleSwap }> {
	const cid = String(input.classId ?? "").trim();
	const fw = Number(input.fromWeekday);
	const fp = Number(input.fromPeriod);
	const tw = Number(input.toWeekday);
	const tp = Number(input.toPeriod);
	const s = String(input.schoolId ?? "").trim();
	if (!cid || !fw || !fp || !tw || !tp) return { ok: false, error: "缺少班级/节次信息" };
	if (fw === tw && fp === tp) return { ok: false, error: "原节和目标节是同一格" };
	const db = getDb();
	// 两节课都得有课（调课才有意义）
	const from = await db
		.prepare("SELECT subject FROM class_schedules WHERE class_id = ? AND weekday = ? AND period_no = ?")
		.get(cid, fw, fp) as { subject: string } | undefined;
	const to = await db
		.prepare("SELECT subject FROM class_schedules WHERE class_id = ? AND weekday = ? AND period_no = ?")
		.get(cid, tw, tp) as { subject: string } | undefined;
	if (!from?.subject) return { ok: false, error: "原节没有课，无法调课" };
	if (!to?.subject) return { ok: false, error: "目标节没有课（空堂无需调课，可直接补课）" };
	// 同一班的重复 pending
	const dup = await db
		.prepare("SELECT id FROM schedule_swaps WHERE class_id = ? AND status = 'pending' AND from_weekday = ? AND from_period = ?")
		.get(cid, fw, fp);
	if (dup) return { ok: false, error: "该节已有待审批的调课申请" };
	const ts = nowIso();
	try {
		const info = await db
			.prepare(
				"INSERT INTO schedule_swaps (school_id, class_id, from_weekday, from_period, to_weekday, to_period, reason, requested_by, status, reviewed_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', '', ?, ?)"
			)
			.run(s, cid, fw, fp, tw, tp, String(input.reason ?? "").slice(0, 200), String(input.requestedBy ?? "").slice(0, 64), ts, ts);
		const id = Number((await info).lastInsertRowid);
		const swap = await db.prepare("SELECT * FROM schedule_swaps WHERE id = ?").get(id) as ScheduleSwap;
		return { ok: true, swap };
	} catch (err) {
		console.warn("[schedules] 提交调课失败：", err);
		return { ok: false, error: "提交失败（数据库错误）" };
	}
}

/** 调课申请列表（按状态过滤可选）。 */
export async function listSwapRequests(status?: string, schoolId = ""): Promise<ScheduleSwap[]> {
	const s = String(schoolId ?? "").trim();
	const rows = s
		? (await getDb()
				.prepare("SELECT * FROM schedule_swaps WHERE school_id = ? ORDER BY created_at DESC")
				.all(s) as ScheduleSwap[])
		: (await getDb().prepare("SELECT * FROM schedule_swaps ORDER BY created_at DESC").all() as ScheduleSwap[]);
	return status ? rows.filter((r) => r.status === status) : rows;
}

/**
 * 审批调课。approve → 把两节课对调（原节内容 ↔ 目标节内容），状态 applied。
 * reject → 仅改状态。幂等：已 applied/rejected 的不可再审。
 */
export async function reviewSwap(id: number, action: "approve" | "reject", reviewer: string): Promise<{ ok: boolean; error?: string }> {
	const db = getDb();
	const swap = await db.prepare("SELECT * FROM schedule_swaps WHERE id = ?").get(id) as ScheduleSwap | undefined;
	if (!swap) return { ok: false, error: "申请不存在" };
	if (swap.status !== "pending") return { ok: false, error: `该申请已${swap.status === "applied" ? "生效" : "处理"}，不能重复审批` };

	try {
		if (action === "approve") {
			// 对调两节课
			const from = await db
				.prepare("SELECT subject, teacher, remark FROM class_schedules WHERE class_id = ? AND weekday = ? AND period_no = ?")
				.get(swap.class_id, swap.from_weekday, swap.from_period) as { subject: string; teacher: string; remark: string } | undefined;
			const to = await db
				.prepare("SELECT subject, teacher, remark FROM class_schedules WHERE class_id = ? AND weekday = ? AND period_no = ?")
				.get(swap.class_id, swap.to_weekday, swap.to_period) as { subject: string; teacher: string; remark: string } | undefined;
			if (!from?.subject && !to?.subject) return { ok: false, error: "两节都是空堂，无可调" };
			// 用 setScheduleCell 交换（空堂用 clear 处理）
			const db2 = getDb();
			await db2.exec("BEGIN");
			try {
				if (from?.subject) {
					await db2.prepare("UPDATE class_schedules SET subject=?, teacher=?, remark=?, updated_at=? WHERE class_id=? AND weekday=? AND period_no=?")
						.run(to?.subject ?? "", to?.teacher ?? "", to?.remark ?? "", nowIso(), swap.class_id, swap.from_weekday, swap.from_period);
				} else {
					await db2.prepare("DELETE FROM class_schedules WHERE class_id=? AND weekday=? AND period_no=?").run(swap.class_id, swap.from_weekday, swap.from_period);
				}
				if (to?.subject) {
					await db2.prepare("UPDATE class_schedules SET subject=?, teacher=?, remark=?, updated_at=? WHERE class_id=? AND weekday=? AND period_no=?")
						.run(from?.subject ?? "", from?.teacher ?? "", from?.remark ?? "", nowIso(), swap.class_id, swap.to_weekday, swap.to_period);
				} else {
					await db2.prepare("DELETE FROM class_schedules WHERE class_id=? AND weekday=? AND period_no=?").run(swap.class_id, swap.to_weekday, swap.to_period);
				}
				await db2.exec("COMMIT");
			} catch (e) {
				await db2.exec("ROLLBACK");
				console.warn("[schedules] 调课生效失败：", e);
				return { ok: false, error: "调课生效失败（数据库错误）" };
			}
		}
		await db.prepare("UPDATE schedule_swaps SET status = ?, reviewed_by = ?, updated_at = ? WHERE id = ?").run(
			action === "approve" ? "applied" : "rejected",
			String(reviewer ?? "").slice(0, 64),
			nowIso(),
			id
		);
		return { ok: true };
	} catch (err) {
		console.warn("[schedules] 审批调课失败：", err);
		return { ok: false, error: "审批失败（数据库错误）" };
	}
}