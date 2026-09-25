/**
 * 班级范围（班级系统 v2 · 2026-09-25）。
 *
 * 回答一个问题：**这个用户能碰哪些班？**
 *   - owner/admin            → "*"（全校，不需要绑定）；
 *   - teacher/homeroom/techrep → user_class_bindings 里绑定的真实 class_id 集合
 *     （没绑定 = 空集 = 什么都推不了，这是「必须绑定班级」的后端半边）；
 *   - 其余角色               → []（连绑定的资格都没有）。
 *
 * 设计约束（与 db.ts 表注释同源）：
 *   · 绑定表里只允许 CIMS 真实 class_id —— 写入侧（管理接口）负责实时校验存在性，
 *     本模块不做网络请求，保持纯本地可测；
 *   · 限额在 permissions.ts 的 CLASS_BIND_LIMITS，本模块写入时强制执行。
 */
import { getDb, nowIso } from "./db.js";
import { classBindLimit, type Role } from "$lib/permissions.js";

export interface ClassBinding {
	class_id: string;
	class_name: string;
	bound_at: string;
	bound_by: string;
}

/** 读某用户的全部班级绑定（按绑定时间升序）。 */
export function listBindings(uid: number): ClassBinding[] {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT class_id, class_name, created_at, bound_by
			 FROM user_class_bindings WHERE uid = ? ORDER BY created_at ASC`
		)
		.all(uid) as { class_id: string; class_name: string; created_at: string; bound_by: string }[];
	return rows.map((r) => ({
		class_id: r.class_id,
		class_name: r.class_name,
		bound_at: r.created_at,
		bound_by: r.bound_by
	}));
}

/** 用户的班级范围："*"（全校）| class_id 数组（可能为空 = 没有范围）。 */
export function classScopeOf(
	role: Role | null | undefined,
	uid: number | null | undefined
): "*" | string[] {
	if (role === "owner" || role === "admin") return "*";
	if (!uid || !requiresBinding(role)) return [];
	return listBindings(uid).map((b) => b.class_id);
}

function requiresBinding(role: Role | null | undefined): boolean {
	return classBindLimit(role) > 0;
}

/**
 * 校验一批 class_id 能否绑定给该用户（不改库）。
 * 返回错误文案（人话）或 null = 通过。existing 由调用方传入当前绑定集。
 */
export function validateBindingSet(
	role: Role | null | undefined,
	/** CIMS /class/list 里的真实 class_id 集合（小写归一后比对）。 */
	validClassIds: Set<string>,
	want: string[],
	existingCount: number
): string | null {
	const limit = classBindLimit(role);
	if (limit === 0) return "该角色没有班级绑定资格（无设备/文件能力）";
	if (limit === -1) return "站长/管理员不需要绑定班级（范围即全校）";
	const ids = [...new Set(want.map((c) => String(c).trim()).filter(Boolean))];
	if (ids.length === 0) return "至少绑定一个班级（该角色必须绑定班级后才有班级范围）";
	if (ids.length > limit) {
		return `该角色最多绑定 ${limit} 个班级（当前提交 ${ids.length} 个）`;
	}
	if (existingCount + ids.length > limit && existingCount > 0) {
		// 全量替换语义下 existingCount 不直接相加；这里防御的是增量语义误用。
		return `该角色最多绑定 ${limit} 个班级`;
	}
	const bad = ids.filter((c) => !validClassIds.has(c.toLowerCase()));
	if (bad.length > 0) {
		return `以下班级不是 CIMS 里的真实班级（或在绑定瞬间已不存在）：${bad.join("、")}`;
	}
	return null;
}

/** 全量替换某用户的绑定集（调用方须已通过 validateBindingSet）。 */
export function replaceBindings(
	uid: number,
	entries: { class_id: string; class_name?: string }[],
	boundBy: string
): ClassBinding[] {
	const db = getDb();
	const del = db.prepare("DELETE FROM user_class_bindings WHERE uid = ?");
	const ins = db.prepare(
		`INSERT OR IGNORE INTO user_class_bindings (uid, class_id, class_name, bound_by, created_at)
		 VALUES (?, ?, ?, ?, ?)`
	);
	const ts = nowIso();
	const run = db.transaction(() => {
		del.run(uid);
		for (const e of entries) {
			ins.run(uid, e.class_id, e.class_name ?? "", boundBy, ts);
		}
	});
	run();
	return listBindings(uid);
}

/**
 * 范围判定：目标班级是否在用户范围内。
 * @param scope classScopeOf 的返回值（"*" 或 id 数组）
 * @param classId 目标班级 id（大小写不敏感）
 */
export function scopeCovers(scope: "*" | string[], classId: string | null | undefined): boolean {
	if (scope === "*") return true;
	const c = String(classId ?? "").trim().toLowerCase();
	if (!c || scope.length === 0) return false;
	return scope.some((s) => s.toLowerCase() === c);
}
