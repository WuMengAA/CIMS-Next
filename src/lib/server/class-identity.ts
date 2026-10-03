/**
 * 班级标识归一（T1 · 2026-10-03）。
 *
 * 背景：CIMS 侧存在**两套** class_id 生成器，且它们产出的是**同一个班**——
 *   canonical  如 `class_2028_8`（class_{毕业年}_{班号}）
 *   legacy     如 `class_08`    （class_{序号:02d}）
 * 生产库 console_audit（id 248 / 290）里有两条 file_push，目标列表里
 * `class_08` 与 `class_2028_8` 并列出现，证明两套 id 指向同一实体。
 *
 * 因此 T1 的口径定死：**以 `class_{毕业年}_{班号}` 为权威**。
 * 理由：`class_08` 不带届，无法区分「2028届8班」和「2029届8班」——届一换，
 * 历史推送、课表组件、设备配置全部串届。带届的 id 才是能当外键的东西。
 *
 * 本模块是纯函数，不查库、不发网络，可单独测。
 *
 * ⚠️ 核心安全约束：`canonicalizeLegacy` **默认不写**。
 *   `class_08` → `class_2028_8` 这个映射看着显然，但它是「靠默认届猜的」。
 *   如果 CIMS 哪天真有两届 8 班，静默猜就会把历史数据挂到错的届上。
 *   所以：默认返回 null（需要显式带 defaultCohort 才 canonicalize），
 *   且 canonicalizeLegacy 永远保留 legacy 原值，让调用方自己决定是否落库。
 */

/** canonical：`class_2028_8` —— 年份 + 班号，可区分届。 */
export interface ClassIdentity {
	kind: "canonical";
	cohort: string;
	no: string;
	id: string;
}

/** legacy：`class_08` —— 只有序号，不含届，无法唯一确定班级。 */
export interface ClassAlias {
	kind: "legacy";
	/** `08`（保留前导零）或 `12`。 */
	no: string;
	id: string;
	/** 非空序号但形态不对（如 `class_1` 无前导零）——仍当 legacy 处理。 */
	oddFormat?: boolean;
}

/** 既不是两套生成器产物：自由文本班名、组织名、或空。 */
export interface ClassUnknown {
	kind: "unknown";
	raw: string;
	/** `org` = 组织而非班级（如「电教管理组」）；`text` = 其他自由文本。 */
	why: "org" | "text" | "empty";
}

export type ParsedClass = ClassIdentity | ClassAlias | ClassUnknown;

/** 组织型名称关键词：命中即判为「组织不是班级」，不许硬映射成 class_id。 */
const ORG_KEYWORDS = ["组", "委员会", "办", "中心", "队", "部", "团"];

const RE_CANONICAL = /^class_(\d{4})_?(\d+(?:[A-Za-z])?)$/i;
const RE_LEGACY = /^class_(\d{1,3})$/i;

/**
 * 解析一个班级标识。不抛异常，任何输入都有确定的归一类别。
 */
export function parseClassIdentity(raw: unknown): ParsedClass {
	const s = String(raw ?? "").trim();
	if (!s) return { kind: "unknown", raw: s, why: "empty" };

	const canon = s.match(RE_CANONICAL);
	if (canon) {
		return {
			kind: "canonical",
			cohort: canon[1],
			no: canon[2],
			id: `class_${canon[1]}_${canon[2]}`
		};
	}
	const legacy = s.match(RE_LEGACY);
	if (legacy) {
		return {
			kind: "legacy",
			// ⚠ 去前导零：CIMS 的 canonical 是 `class_2028_1`，不是 `class_2028_01`。
			// 归一后的 no 只用于比较与拼接；原值走 id，便于比对和回滚。
			no: String(Number(legacy[1])),
			id: s,
			oddFormat: legacy[1].length < 2 && legacy[1] !== "0"
		};
	}
	const why: "org" | "text" = ORG_KEYWORDS.some((k) => s.includes(k)) ? "org" : "text";
	return { kind: "unknown", raw: s, why };
}

/** 从 canonical id 构造；形态不对返回 null。 */
export function canonicalId(cohort: string, no: string): string | null {
	const c = parseClassIdentity(`class_${cohort}_${no}`);
	return c.kind === "canonical" ? c.id : null;
}

/**
 * 把 legacy id 换写成 canonical。**默认不写**：不给 defaultCohort 就返回 null，
 * 调用方必须显式表态「我知道这个班属于哪一届」才会得到结果。
 *
 * 返回对象同时带 `alias`（原值）与 `canonical`，调用方按需落库，
 * 便于做「双认过渡」：读旧值、写新值、比对时两个都认。
 */
export function canonicalizeLegacy(
	raw: unknown,
	defaultCohort?: string
): { canonical: string; alias: string; cohort: string; no: string } | null {
	const p = parseClassIdentity(raw);
	if (p.kind === "canonical") return null;
	if (p.kind !== "legacy") return null;
	const cohort = String(defaultCohort ?? "").trim();
	if (!/^\d{4}$/.test(cohort)) return null;
	return { canonical: `class_${cohort}_${p.no}`, alias: p.id, cohort, no: p.no };
}

/**
 * 判两个班级标识是否指同一个班（大小写不敏感）。
 * 规则：
 *   · 两个 canonical → 完整 id 相等；
 *   · 两个 legacy    → 序号相等（`class_08` == `class_8`）；
 *   · canonical vs legacy → **不相等**。这是刻意的：
 *       没有届的 `class_08` 不能等同于任何具体届的 `class_2028_8`，
 *       否则多届并存时会静默串届。想跨形态匹配，得显式给默认届。
 */
export function sameClass(a: unknown, b: unknown): boolean {
	const x = parseClassIdentity(a);
	const y = parseClassIdentity(b);
	if (x.kind === "canonical" && y.kind === "canonical") return x.id === y.id;
	if (x.kind === "legacy" && y.kind === "legacy") return x.no === y.no;
	return false;
}

/**
 * 双认归一：把任意班级写法解析成「能当外键的 canonical id」。
 *
 * @param raw            原始写法（class_id / 班级名 / 组织名 / 空）
 * @param cimsClasses    CIMS 当前班级表（真实 class_id → name），用于校验与取名
 * @param opts.defaultCohort  legacy 序号归一时用的届；缺省则不做 legacy→canonical
 *
 * @returns resolved 可能是 canonical id、可能是 null（无 canonical 可用）。
 *          matched 说明判定路径；ambiguous 表示有多个候选（调用方必须人工介入）。
 */
export function resolveClassKey(
	raw: unknown,
	cimsClasses: { class_id: string; name?: string }[],
	opts: { defaultCohort?: string } = {}
): {
	resolved: string | null;
	matched: "canonical" | "legacy-alias" | "none";
	ambiguous: boolean;
	unknown: ClassUnknown | null;
} {
	const p = parseClassIdentity(raw);
	if (p.kind === "unknown") {
		return { resolved: null, matched: "none", ambiguous: false, unknown: p };
	}
	if (p.kind === "canonical") {
		return {
			resolved: p.id,
			matched: "canonical",
			ambiguous: false,
			unknown: null
		};
	}
	// legacy：查 CIMS 里是否有「同序号的 canonical」。
	const cands = cimsClasses.filter((c) => {
		const q = parseClassIdentity(c.class_id);
		return q.kind === "canonical" && q.no === p.no;
	});
	if (cands.length === 1) {
		return {
			resolved: cands[0].class_id,
			matched: "legacy-alias",
			ambiguous: false,
			unknown: null
		};
	}
	if (cands.length > 1) {
		// 多届同序号 —— 真撞号了，绝不猜。
		return { resolved: null, matched: "legacy-alias", ambiguous: true, unknown: null };
	}
	// 序号无 canonical 兜底，且给了默认届 → 用默认届造一个。
	const withCohort = canonicalizeLegacy(p.id, opts.defaultCohort);
	if (withCohort) return { resolved: withCohort.canonical, matched: "legacy-alias", ambiguous: false, unknown: null };
	return { resolved: null, matched: "legacy-alias", ambiguous: false, unknown: null };
}
