/**
 * 班级真源（自有，2026-10-04 · 「取代 CIMS」第二步）。
 *
 * 数据落在站点 SQLite 表 `stelarith_classes`（见 db.ts / 迁移脚本），
 * 由 CIMS /class/list 一次性迁入；此后站点读班级不再依赖 CIMS。
 *
 * 为什么建自有班级表：
 *   · CIMS 退伍后（裁决：全量退伍 + 数据切自有），班级列表不能断供；
 *   · 此前 /api/classes 直连 CIMS（cims-client.fetchClassList），CIMS 一挂班级就空；
 *   · 现在站点自持 13 个班的 class_id/name/sort_order，读取零依赖。
 *
 * 纪律：
 *   · 本表是**只读真源**，写入口只有迁移脚本与管理端操作（不在运行时随手写）；
 *   · CIMS 仍在线时可用"重新同步"入口刷新（幂等 upsert），停 CIMS 后本表照常服务。
 */
import { getDb } from "../db.js";

export interface StelarithClass {
	class_id: string;
	school_id: string;
	name: string;
	code: string;
	sort_order: number;
	created_at: string;
}

/** 全量班级列表（按 sort_order）。school_id 为空 = 不过滤（单学校兼容，多学校预留）。
 *  查不到/空表返空数组 —— 调用方据空表决定是否降级。 */
export async function listStelarithClasses(schoolId = ""): Promise<StelarithClass[]> {
	const s = String(schoolId ?? "").trim();
	const rows = s
		? await getDb()
				.prepare("SELECT class_id, school_id, name, code, sort_order, created_at FROM stelarith_classes WHERE school_id = ? ORDER BY sort_order ASC")
				.all(s)
		: await getDb()
				.prepare("SELECT class_id, school_id, name, code, sort_order, created_at FROM stelarith_classes ORDER BY sort_order ASC")
				.all();
	return rows as unknown as StelarithClass[];
}

/** 单班查询（class_id 精确；school_id 兼容）。 */
export async function getStelarithClass(classId: string, schoolId = ""): Promise<StelarithClass | null> {
	const id = String(classId ?? "").trim();
	if (!id) return null;
	const s = String(schoolId ?? "").trim();
	const row = s
		? (await getDb()
				.prepare("SELECT class_id, school_id, name, code, sort_order, created_at FROM stelarith_classes WHERE class_id = ? AND school_id = ?")
				.get(id, s) as StelarithClass | undefined)
		: (await getDb()
				.prepare("SELECT class_id, school_id, name, code, sort_order, created_at FROM stelarith_classes WHERE class_id = ?")
				.get(id) as StelarithClass | undefined);
	return row ?? null;
}

/** 本地班级是否可用（有数据 = 真源就绪，不必问 CIMS）。 */
export async function stelarithClassesReady(): Promise<boolean> {
	return await (await listStelarithClasses()).length > 0;
}

/**
 * 幂等刷新：把一批班级 upsert 进自有表（迁移脚本 / 管理端"重新同步 CIMS"用）。
 * 返回写入行数。
 */
export async function upsertStelarithClasses(classes: { class_id: string; name: string; code?: string; sort_order?: number; school_id?: string }[]): Promise<number> {
	let n = 0;
	const ts = new Date().toISOString();
	for (const c of classes) {
		if (!c.class_id) continue;
		const info = await getDb()
			.prepare(
				`INSERT INTO stelarith_classes (class_id, school_id, name, code, sort_order, created_at)
				 VALUES (?, ?, ?, ?, ?, ?)
				 ON CONFLICT(class_id) DO UPDATE SET
				   name = excluded.name, code = excluded.code, sort_order = excluded.sort_order`
			)
			.run(
				c.class_id,
				String(c.school_id ?? ""),
				String(c.name ?? c.class_id),
				String(c.code ?? ""),
				Number(c.sort_order ?? 0),
				ts
			);
		if ((await info).changes > 0) n++;
	}
	return n;
}

/* ── 2026-10-04 · 班级管理写操作（彻底去 CIMS：建/改/删班走自有表） ── */

/** 建班（管理端）。class_id 自动生成（c{n}，n = 当前最大序号+1），name 必填。
 *  返回新班；班级已存在（同名）→ null 由调用方报错。school_id 多学校预留（默认 '' 单学校）。 */
export async function createStelarithClass(input: { name: string; code?: string; school_id?: string }): Promise<StelarithClass | null> {
	const name = String(input.name ?? "").trim();
	if (!name) return null;
	const s = String(input.school_id ?? "").trim();
	const db = getDb();
	const dup = s
		? (await db.prepare("SELECT class_id FROM stelarith_classes WHERE name = ? COLLATE NOCASE AND school_id = ?").get(name, s) as { class_id: string } | undefined)
		: (await db.prepare("SELECT class_id FROM stelarith_classes WHERE name = ? COLLATE NOCASE").get(name) as { class_id: string } | undefined);
	if (dup) return null;
	const row = await db.prepare("SELECT MAX(sort_order) AS m FROM stelarith_classes").get() as { m: number | null };
	const sort_order = Number(row?.m ?? 0) + 1;
	const class_id = `c${sort_order}`;
	const ts = new Date().toISOString();
	try {
		await db.prepare(
			"INSERT INTO stelarith_classes (class_id, school_id, name, code, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)"
		).run(class_id, s, name, String(input.code ?? ""), sort_order, ts);
		return await getStelarithClass(class_id, s);
	} catch (err) {
		console.warn("[stelarith/classes] 建班失败：", err);
		return null;
	}
}

/** 改班（管理端）。改班名（唯一性校验）+ 可选改 code。查不到 → null。school_id 兼容。 */
export async function updateStelarithClass(
	classId: string,
	input: { name?: string; code?: string; school_id?: string }
): Promise<StelarithClass | null> {
	const id = String(classId ?? "").trim();
	if (!id) return null;
	const s = String(input.school_id ?? "").trim();
	const db = getDb();
	const name = String(input.name ?? "").trim();
	if (name) {
		const dup = s
			? (await db.prepare("SELECT class_id FROM stelarith_classes WHERE name = ? COLLATE NOCASE AND class_id != ? AND school_id = ?").get(name, id, s) as { class_id: string } | undefined)
			: (await db.prepare("SELECT class_id FROM stelarith_classes WHERE name = ? COLLATE NOCASE AND class_id != ?").get(name, id) as { class_id: string } | undefined);
		if (dup) return null;
	}
	try {
		const cur = await getStelarithClass(id, s);
		if (!cur) return null;
		await db.prepare("UPDATE stelarith_classes SET name = ?, code = ? WHERE class_id = ?").run(
			name || cur.name,
			String(input.code ?? cur.code ?? ""),
			id
		);
		return await getStelarithClass(id, s);
	} catch (err) {
		console.warn("[stelarith/classes] 改班失败：", err);
		return null;
	}
}

/** 删班（管理端）。班里还有设备 → 拒绝（返回 {deleted:false, blockedByDevices:n}），防孤儿绑定。
 *  查不到 → {deleted:false, notFound:true}。成功 → {deleted:true}。 */
export async function deleteStelarithClass(classId: string): Promise<{ deleted: boolean; blockedByDevices?: number; notFound?: boolean }> {
	const id = String(classId ?? "").trim();
	if (!id) return { deleted: false };
	const db = getDb();
	try {
		const cur = await getStelarithClass(id);
		if (!cur) return { deleted: false, notFound: true };
		const devs = await db.prepare("SELECT COUNT(*) AS n FROM device_bindings WHERE class_id = ? AND status = 'active'").get(id) as { n: number };
		if (Number(devs?.n ?? 0) > 0) return { deleted: false, blockedByDevices: Number(devs.n) };
		await db.prepare("DELETE FROM stelarith_classes WHERE class_id = ?").run(id);
		return { deleted: true };
	} catch (err) {
		console.warn("[stelarith/classes] 删班失败：", err);
		return { deleted: false };
	}
}
