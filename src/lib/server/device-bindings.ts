/**
 * 设备 ↔ 班级绑定（站点自持真源，2026-10-04 · 「取代 CIMS」第一步）。
 *
 * 数据落在站点自己的 SQLite（表 device_bindings，见 db.ts）。
 *
 * 为什么要有这一层：
 *   · 此前"哪台机器在哪个班"只由 CIMS 的 `/class/device-map` 回答（cims-client.classOfDevice）；
 *     接入码消费成功只在码上写 usedBy，设备→班级**不落任何库** —— 查不到、不可审计。
 *   · CIMS 不可达时 classOfDevice 返 null，整个面板就"不知道机器在哪班"。
 * 于是：登记（谁用完码 → 归了哪个班）写本地表；读取**本地优先**，CIMS 降级为兜底。
 *
 * 边界（刻意的）：本模块只做**登记**（记录事实），不做**准入**（不拦截未登记设备）。
 * 未登记的设备照旧由 CIMS 回答（若 CIMS 也在线）；两边都没有 → 交给上层按"确定不了"处理。
 */
import { getDb, nowIso } from "./db.js";
import { getStelarithClass } from "./stelarith/classes.js";

/**
 * CIMS 兜底**延迟加载**：只有在"本地一条登记都没有、确实要去问 CIMS"这一支才
 * 动态 import cims-client —— 本地优先的常态路径完全不加载它（少一层 SvelteKit
 * `$env` 依赖，也让本模块能脱离站点运行时单独跑探针）。
 */
async function cimsDeviceClassMap() {
	const mod = await import("./cims-client.js");
	return mod.fetchDeviceClassMap();
}

export type DeviceBinding = {
	uid: string;
	class_id: string;
	class_name: string;
	bound_by: string;
	display_name: string;
	status: string;
	created_at: string;
	updated_at: string;
};

const SELECT_COLS = "uid, class_id, class_name, bound_by, display_name, status, created_at, updated_at";

/**
 * 登记 / 更新一台设备的归班（幂等 upsert）。
 *
 * 触发点：接入码消费成功（`/api/device/activate`）。同一 uid 再次激活 = 改归属：
 * class_id/class_name/bound_by 覆盖，created_at 保留首绑时间（首绑才是"设备入网"的时刻），
 * updated_at 记这次改写。display_name 由管理员后续改（本 upsert 不动它，尊重人工命名）。
 *
 * fail-soft：写库出错只告警、不抛 —— 设备接入是主链路，登记不能把接入卡死。
 */
export function recordDeviceBinding(input: {
	uid: string;
	schoolId?: string;
	classId?: string;
	className?: string;
	boundBy?: string;
}): boolean {
	const uid = String(input.uid ?? "").trim();
	if (!uid) return false;
	try {
		const ts = nowIso();
		getDb()
			.prepare(
				`INSERT INTO device_bindings (uid, school_id, class_id, class_name, bound_by, display_name, status, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, '', 'active', ?, ?)
				 ON CONFLICT(uid) DO UPDATE SET
				   school_id  = excluded.school_id,
				   class_id   = excluded.class_id,
				   class_name = excluded.class_name,
				   bound_by   = excluded.bound_by,
				   status     = 'active',
				   updated_at = excluded.updated_at`
			)
			.run(
				uid,
				String(input.schoolId ?? ""),
				String(input.classId ?? ""),
				String(input.className ?? ""),
				String(input.boundBy ?? ""),
				ts,
				ts
			);
		return true;
	} catch (err) {
		console.warn("[device-bindings] 登记设备归班失败（不阻断接入）：", err);
		return false;
	}
}

/** 管理端改机器显示名（"高三3班讲台机"之类）；空串 = 回落班级名。 */
export function setDeviceDisplayName(uid: string, displayName: string): boolean {
	const u = String(uid ?? "").trim();
	if (!u) return false;
	const info = getDb()
		.prepare("UPDATE device_bindings SET display_name = ?, updated_at = ? WHERE uid = ?")
		.run(String(displayName ?? "").slice(0, 64), nowIso(), u) as { changes?: number };
	return !!info?.changes;
}

/** 管理端手动归班（2026-10-04 · 彻底去 CIMS：/class/device/assign 的自有替代）。
 *  设备已在表里 → 改归属；不在（CIMS 兜底时期的新机器）→ 插入一行。
 *  @returns 成功与否；班级名自动从 stelarith_classes 取（查不到用传入值/classId）。 */
export function assignDeviceToClass(input: { uid: string; classId: string; className?: string; by?: string }): boolean {
	const uid = String(input.uid ?? "").trim();
	const classId = String(input.classId ?? "").trim();
	if (!uid || !classId) return false;
	try {
		// 班级名与 school_id 优先从自有班级表取（避免脏名/跨学校错绑）；取不到回落调用方给的
		const cls = getStelarithClass(classId);
		const className = (cls?.name ?? String(input.className ?? "")).trim();
		return recordDeviceBinding({ uid, classId, className, schoolId: cls?.school_id ?? "", boundBy: input.by ?? "manual" });
	} catch (err) {
		console.warn("[device-bindings] 手动归班失败：", err);
		return false;
	}
}

/** 管理端移出班级（2026-10-04 · /class/device/unassign 的自有替代）。
 *  清空 class_id/class_name，状态置 unbound（保留登记行，不删——审计要留底）。 */
export function unassignDeviceFromClass(uid: string): boolean {
	const u = String(uid ?? "").trim();
	if (!u) return false;
	try {
		const info = getDb()
			.prepare("UPDATE device_bindings SET class_id = '', class_name = '', status = 'unbound', updated_at = ? WHERE uid = ?")
			.run(nowIso(), u) as { changes?: number };
		return !!info?.changes;
	} catch (err) {
		console.warn("[device-bindings] 移出班级失败：", err);
		return false;
	}
}

/** 全部登记行（管理端列表 / 本地 device-map 用）。 */
export function listDeviceBindings(): DeviceBinding[] {
	return getDb()
		.prepare(`SELECT ${SELECT_COLS} FROM device_bindings ORDER BY created_at DESC`)
		.all() as DeviceBinding[];
}

/** 单台设备的本地归班（uid 不区分大小写匹配，与 CIMS 映射同一约定）。查不到返 null。 */
export function localClassOfDevice(uid: string): DeviceBinding | null {
	const u = String(uid ?? "").trim();
	if (!u) return null;
	return (
		(getDb()
			.prepare(`SELECT ${SELECT_COLS} FROM device_bindings WHERE uid = ? COLLATE NOCASE LIMIT 1`)
			.get(u) as DeviceBinding | undefined) ?? null
	);
}

/**
 * 读取"哪台机器在哪个班" —— **本地优先，CIMS 兜底**。取代 CIMS 的唯一来源地位。
 *
 * 顺序：
 *   1) 先把本地 device_bindings 全量转成 uid→class_id（键 = 存进去的原样 uid，
 *      另附小写键，兼容调用方按小写查）；
 *   2) 本地没登记到的设备，才去问 CIMS `/class/device-map`（cims-client），
 *      并且**不覆盖**本地已有的归属（本地是登记事实，优先级更高）；
 *   3) CIMS 不可达 → 返回纯本地结果（`source:"local"`），不再返 null。
 *
 * 返回形态与 cims-client.fetchDeviceClassMap 对齐（uidToClass / devices / classes），
 * 额外多一个 `source` 供调用方判断这批数据到底来自哪。
 */
export async function resolveDeviceClassMap(): Promise<{
	uidToClass: Map<string, string>;
	devices: { uid: string; class_id: string }[];
	classes: { class_id: string; name: string }[];
	source: "local" | "local+cims" | "cims";
}> {
	const rows = listDeviceBindings();
	const uidToClass = new Map<string, string>();
	const devices: { uid: string; class_id: string }[] = [];
	const classMap = new Map<string, string>(); // class_id -> name（去重）
	for (const r of rows) {
		devices.push({ uid: r.uid, class_id: r.class_id });
		if (r.class_id) {
			uidToClass.set(r.uid, r.class_id);
			uidToClass.set(r.uid.toLowerCase(), r.class_id);
			if (r.class_name) classMap.set(r.class_id, r.class_name);
		}
	}

	let source: "local" | "local+cims" | "cims" = rows.length ? "local" : "cims";
	// 本地有登记就不再打扰 CIMS（"取代 CIMS"的本意：本地够用就不依赖它）。
	// 本地为空（迁移期 / 尚未有设备登记）才回退去问 CIMS，避免上线瞬间"一台都看不见"。
	if (rows.length === 0) {
		try {
			const m = await cimsDeviceClassMap();
			if (m) {
				for (const [uid, cid] of m.uidToClass) {
					// CIMS 的 uidToClass 键是小写；values 是 class_id
					if (cid && !uidToClass.has(uid)) uidToClass.set(uid, cid);
				}
				for (const d of m.devices) {
					if (!devices.some((x) => x.uid.toLowerCase() === d.uid.toLowerCase())) {
						devices.push({ uid: d.uid, class_id: d.class_id });
					}
				}
				for (const c of m.classes) classMap.set(c.class_id, c.name);
				source = "cims";
			}
		} catch {
			/* CIMS 不可达：纯本地结果照常返回（这正是"取代 CIMS"的实证） */
		}
	}

	return {
		uidToClass,
		devices,
		classes: [...classMap].map(([class_id, name]) => ({ class_id, name })),
		source
	};
}

/**
 * 单台设备归班（**本地优先，CIMS 兜底**）——`cims-client.classOfDevice` 的自有替代。
 *
 * 2026-10-04（取代 CIMS）：
 *   · 先查本地 device_bindings（登记的事实，优先）；
 *   · 本地没这台 → 动态 import CIMS 兜底（迁移期/新设备尚未登记）；
 *   · CIMS 也不可达 → null，调用方按「确定不了就不放行」处理（与旧行为一致）。
 */
export async function resolveClassOfDevice(uid: string): Promise<string | null> {
	const local = localClassOfDevice(uid);
	if (local?.class_id) return local.class_id;
	try {
		const { classOfDevice } = await import("./cims-client.js");
		return await classOfDevice(uid);
	} catch {
		return null;
	}
}
