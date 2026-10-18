/**
 * 设备台账（自有，2026-10-04 ·「取代 CIMS」设备域单一出口）。
 *
 * 背景：
 *   · "哪台机器在哪个班"此前只有 CIMS 的 `/class/device-map` 回答，CIMS 一挂整块面板就瞎；
 *   · 站点自己已经把接入码消费结果写进 `device_bindings`（见 db.ts / device-bindings.ts），
 *     于是这里把它收成**一个出口**：所有"设备→班级"的读取都从这儿走，CIMS 只做兜底。
 *
 * 纪律（本仓库反复栽过的）：
 *   · **不许另立第三套真源** —— 归班数据仍只有 `device_bindings` 一张表，本文件只是出口；
 *   · **uid 大小写敏感** —— canonicalUid 保留原始大小写，精确命中优先，绝不把 uid 一律小写化
 *     （历史事故：一律小写会把指令投进离线记录）；
 *   · **不许静默** —— CIMS 兜底失败要能看出来（返回 source / cimsReached），由上层决定怎么提示。
 */
import { listDeviceBindings, localClassOfDevice, type DeviceBinding } from "../device-bindings.js";

export type { DeviceBinding };

/**
 * uid 规范化：**保留原始大小写**（作为身份），另提供"精确优先、其次小写"的查找语义。
 *
 * 用法：查一台设备时，先拿原始 uid 精确查；查不到再用小写归一查一次。
 * 下发生效的写操作（指令、文件推送）**一律只用原始 uid**，不走这里的小写归一。
 */
export function canonicalUid(raw: string): string {
	return String(raw ?? "").trim();
}

/** 按小写查找用的键（仅供"读取时兼容历史小写数据"，不是身份本身）。 */
export function uidLookupKey(raw: string): string {
	return canonicalUid(raw).toLowerCase();
}

export type LedgerEntry = DeviceBinding & { lookupKey: string };

export type ClassMapResult = {
	uidToClass: Map<string, string>;
	devices: { uid: string; class_id: string }[];
	classes: { class_id: string; name: string }[];
	/** 这批数据到底来自哪：local（自持）/ local+cims（本地打底 + CIMS 补齐）/ cims（仅 CIMS） */
	source: "local" | "local+cims" | "cims";
	/** CIMS 兜底这条腿有没有真的走通（false = 根本没问，或问了失败） */
	cimsReached: boolean;
	count: number;
};

/**
 * 纯逻辑：把设备绑定行组装成 uid→class 映射（**不碰数据库**，便于单独验证）。
 *
 * 键的规则：既放原始 uid（身份），也放小写键（兼容历史按小写查的调用方），
 * 但 **value 一律用原始 uid 对应的 class_id**，不做任何归一化。
 */
export function buildClassMap(rows: DeviceBinding[]): Pick<ClassMapResult, "uidToClass" | "devices" | "classes"> {
	const uidToClass = new Map<string, string>();
	const devices: { uid: string; class_id: string }[] = [];
	const classNames = new Map<string, string>();

	for (const r of rows) {
		const uid = canonicalUid(r?.uid);
		if (!uid) continue;
		devices.push({ uid, class_id: r.class_id ?? "" });
		if (r.class_id) {
			uidToClass.set(uid, r.class_id);
			uidToClass.set(uid.toLowerCase(), r.class_id);
			if (r.class_name) classNames.set(r.class_id, r.class_name);
		}
	}

	return {
		uidToClass,
		devices,
		classes: [...classNames].map(([class_id, name]) => ({ class_id, name }))
	};
}

/**
 * 设备台账全量读取。
 *
 * 顺序（与 device-bindings 的既有策略一致，行为不变）：
 *   1) 本地 `device_bindings` 优先；
 *   2) 本地一条都没有时才去问 CIMS `/class/device-map`（复用 device-bindings 的延迟加载，
 *      **本文件不新增任何 CIMS 依赖**）；
 *   3) CIMS 不可达不抛错 —— 照常返回本地结果，但 `cimsReached:false` 让上层看得见。
 */
export async function listDeviceLedger(): Promise<LedgerEntry[] & { source: ClassMapResult["source"]; cimsReached: boolean }> {
	const rows = await listDeviceBindings();
	const entries: LedgerEntry[] = (await rows).map((r) => ({ ...r, lookupKey: uidLookupKey(r.uid) }));

	if ((await rows).length === 0) {
		try {
			const { resolveDeviceClassMap } = await import("../device-bindings.js");
			const m = await resolveDeviceClassMap();
			if (m?.devices?.length) {
				for (const d of m.devices) {
					if (!entries.some((x) => uidLookupKey(x.uid) === uidLookupKey(d.uid))) {
						entries.push({ uid: d.uid, class_id: d.class_id } as LedgerEntry);
					}
				}
			}
		} catch {
			/* CIMS 不可达：纯本地结果照常返回，由调用方按 cimsReached=false 提示 */
		}
	}

	return Object.assign(entries, {
		source: (await rows).length ? ("local" as const) : ("cims" as const),
		cimsReached: (await rows).length > 0
	});
}

/** 单台设备的本地归班（查不到返 null）。与 device-bindings 同名实现同语义，导出为域出口。 */
export async function deviceClassOf(uid: string): Promise<DeviceBinding | null> {
	return await localClassOfDevice(uid);
}

/**
 * 设备→班级映射（供现有调用方无感切换）。
 * 形态与 device-bindings.resolveDeviceClassMap 完全对齐，多带 `cimsReached`。
 */
export async function resolveDeviceClassMap(): Promise<ClassMapResult> {
	const rows = await listDeviceBindings();
	const { uidToClass, devices, classes } = buildClassMap(rows);
	let source: ClassMapResult["source"] = (await rows).length ? "local" : "cims";
	let cimsReached = (await rows).length > 0;

	// 本地有登记就不再打扰 CIMS（"取代 CIMS"的本意：本地够用就不依赖它）。
	if ((await rows).length === 0) {
		try {
			const { resolveDeviceClassMap: cimsMap } = await import("../device-bindings.js");
			const m = await cimsMap();
			if (m) {
				for (const [uid, cid] of m.uidToClass) {
					if (cid && !uidToClass.has(uid)) uidToClass.set(uid, cid);
				}
				for (const d of m.devices) {
					if (!devices.some((x) => x.uid.toLowerCase() === d.uid.toLowerCase())) {
						devices.push({ uid: d.uid, class_id: d.class_id });
					}
				}
				for (const c of m.classes) {
					const hit = classes.find((x) => x.class_id === c.class_id);
					if (hit) hit.name = c.name;
					else classes.push({ class_id: c.class_id, name: c.name });
				}
				source = "cims";
				cimsReached = true;
			}
		} catch {
			/* CIMS 不可达：返回空映射 + cimsReached=false，**绝不静默谎报成功** */
		}
	}

	return { uidToClass, devices, classes, source, cimsReached, count: devices.length };
}
