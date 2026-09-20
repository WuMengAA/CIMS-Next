/**
 * 权限晋升申请（#181）—— 「申请 + 能力证明 + 逐级审批」的服务端实现。
 *
 * ## 为什么需要它
 *
 * 等级轴（L1 游客 … L6 站长）此前只能由管理员在「用户管理」里**直接改角色**：
 * 没有人知道「这人凭什么该进集控」。本模块把这条链路显式化 ——
 *
 *   低等级用户提交申请（附能力证明）→ 高等级用户批准 → 角色升级
 *
 * ## 三条硬规则（都在服务端，前端只是提示）
 *
 * 1. **逐级晋升**：目标等级必须恰好是当前等级 + 1。不能 L2 直接申 L5 审核员 ——
 *    否则「能力证明」无从证明（学生拿不出审核履历），审核权会在一步之内被套走。
 * 2. **审批人必须严格高于目标等级**（`reviewerLevel > targetLevel`）。只校验
 *    `can(reviewPermission)` 是不够的：该动作定在 L5，于是 L5 审核员能批准
 *    「升到 L5」的申请 —— 等于自己给自己发审核权。要求严格大于之后，
 *    L3/L4 由 L5 批、L5 只能由 L6 批。
 * 3. **陈旧申请不执行**：批准前比对申请人**当前**角色与申请里的 `from_role`。
 *    若中途已被别的管理员改过角色，这张申请已失去前提 —— 直接照 target_role
 *    写回去会把人家**降级**。此时拒绝执行并要求重新申请。
 *
 * ## 存储位置
 *
 * 落 SQLite（同 `users` 表所在库），因为批准要同时改 `users.role`，两者必须同源。
 * 明细见 `db.ts` 里 `role_requests` 表注释。
 */

import { getDb, nowIso } from "./db.js";
import { getUser, adminUpdateUser } from "./auth.js";
import { can, userCan, roleToLevel, ROLE_LABELS, LEVEL_LABELS, PROOF_TYPES, PROOF_TYPE_KEYS } from "$lib/permissions.js";
import type { Role, Level } from "$lib/permissions.js";

export { PROOF_TYPES };

/** 申请状态。 */
export type RoleRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface RoleRequest {
	id: string;
	userId: number;
	username: string;
	fromRole: string;
	fromLevel: number;
	targetRole: string;
	targetLevel: number;
	realName: string;
	contact: string;
	proofType: string;
	proofRef: string;
	className: string;
	gradeName: string;
	reason: string;
	evidence: string;
	status: RoleRequestStatus;
	reviewer: string;
	reviewNote: string;
	createdAt: string;
	reviewedAt: string | null;
}

// ── 可申请的目标角色 ────────────────────────────────────────────────────────
//
// 每个等级对应「该等级的代表角色」。L5 有**两个**职能岗（审核员 / 编辑），
// 二者等级相同但广播范围不同（本年级 / 全校），因此申请时要显式二选一，
// 不能替申请人猜 —— 猜错等于默默给了全校广播权。
//
// L6（站长）**不开放申请**：现任站长直接指派，避免「申请 → 审批」在最高层
// 自我循环（按规则 2，没有任何等级能批准 L6）。
const PROMOTION_ROLES: Record<Level, Role[]> = {
	1: [],
	2: ["user"],
	3: ["techrep"],
	4: ["teacher"],
	5: ["moderator", "editor"],
	6: []
};

/** 能力证明的取值（前端下拉与服务端校验共用）。 */
// 目录本体在 `$lib/permissions.ts`（纯模块，客户端页面也要用），此处仅按需再导出。
const PROOF_TYPE_KEYS_SET = new Set(PROOF_TYPE_KEYS);

/** 当前角色可申请的目标角色清单（逐级：只有上一级的角色）。 */
export function applicableTargets(fromRole: Role | string | null | undefined): Role[] {
	const lv = roleToLevel((fromRole ?? null) as Role | null);
	if (lv === null) return [];
	if (lv >= 6) return [];
	return PROMOTION_ROLES[(lv + 1) as Level] ?? [];
}

/**
 * 供界面/接口下发的目标清单（带中文标签与等级）。
 *
 * 页面 load 与 `/api/role-requests?scope=mine` **必须**共用这一个函数 ——
 * 否则两处会各自拼一份：曾经接口下发裸字符串 `["techrep"]`、页面下发富对象，
 * 前端拿同一个字段却要按两种形状解析（谁先改谁就悄悄把对方打挂）。
 */
export function targetOptions(fromRole: Role | string | null | undefined): {
	role: Role;
	label: string;
	level: Level | null;
	levelLabel: string;
}[] {
	return applicableTargets(fromRole).map((t) => {
		const lv = roleToLevel(t);
		return {
			role: t,
			label: ROLE_LABELS[t],
			level: lv,
			levelLabel: lv === null ? "" : LEVEL_LABELS[lv as Level]
		};
	});
}

/** 目标角色 -> 等级（申请时服务端自行推导，**不信任前端传来的等级**）。 */
function targetLevelOf(role: string): number {
	const lv = roleToLevel(role as Role);
	return lv === null ? 0 : lv;
}

function genId(): string {
	return "rr_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

interface Row {
	id: string;
	user_id: number;
	username: string;
	from_role: string;
	from_level: number;
	target_role: string;
	target_level: number;
	real_name: string;
	contact: string;
	proof_type: string;
	proof_ref: string;
	class_name: string;
	grade_name: string;
	reason: string;
	evidence: string;
	status: string;
	reviewer: string;
	review_note: string;
	created_at: string;
	reviewed_at: string | null;
}

function toRequest(r: Row): RoleRequest {
	return {
		id: r.id,
		userId: r.user_id,
		username: r.username,
		fromRole: r.from_role,
		fromLevel: r.from_level,
		targetRole: r.target_role,
		targetLevel: r.target_level,
		realName: r.real_name,
		contact: r.contact,
		proofType: r.proof_type,
		proofRef: r.proof_ref,
		className: r.class_name,
		gradeName: r.grade_name,
		reason: r.reason,
		evidence: r.evidence,
		status: r.status as RoleRequestStatus,
		reviewer: r.reviewer,
		reviewNote: r.review_note,
		createdAt: r.created_at,
		reviewedAt: r.reviewed_at
	};
}

/** 能力证明的可读摘要（后台列表直接显示，免得审核人逐个字段拼）。 */
export function proofSummary(r: RoleRequest): string {
	const t = PROOF_TYPES.find((p) => p.key === r.proofType);
	const label = t ? t.label : r.proofType || "未填写";
	const ref = r.proofRef ? `：${r.proofRef}` : "";
	return label + ref;
}

// ── 提交 ────────────────────────────────────────────────────────────────────

export interface SubmitInput {
	username: string;
	targetRole: string;
	realName?: string;
	contact?: string;
	proofType?: string;
	proofRef?: string;
	className?: string;
	gradeName?: string;
	reason?: string;
	evidence?: string;
}

export function submitRoleRequest(input: SubmitInput): { ok: true; request: RoleRequest } | { ok: false; error: string } {
	const user = getUser(input.username);
	if (!user) return { ok: false, error: "用户不存在" };

	const fromRole = user.role as Role;
	const fromLevel = roleToLevel(fromRole);
	if (fromLevel === null) return { ok: false, error: "当前账号角色异常，无法申请" };

	const targets = applicableTargets(fromRole);
	if (targets.length === 0) {
		return {
			ok: false,
			error:
				fromLevel >= 6
					? "已是最高等级（L6 管理·站长），无需申请"
					: "当前等级无可申请的晋升目标"
		};
	}
	const target = String(input.targetRole || "").trim();
	if (!targets.includes(target as Role)) {
		// 把可选清单一并回给调用方，前端提示才具体（"只能申 L3 电教委员"）。
		return {
			ok: false,
			error: `只允许逐级晋升：当前 ${LEVEL_LABELS[fromLevel as Level] ?? fromLevel}，可申请 ${targets
				.map((t) => ROLE_LABELS[t])
				.join(" / ")}`
		};
	}

	// ── 能力证明必填校验 ──
	const realName = String(input.realName || "").trim();
	const contact = String(input.contact || "").trim();
	const proofType = String(input.proofType || "").trim();
	const proofRef = String(input.proofRef || "").trim();
	const reason = String(input.reason || "").trim();
	const evidence = String(input.evidence || "").trim();

	if (!realName) return { ok: false, error: "请填写真实姓名（审核人需要知道在为谁背书）" };
	if (!contact) return { ok: false, error: "请填写联系方式（审核可能需回访）" };
	if (!proofType || !PROOF_TYPE_KEYS_SET.has(proofType)) return { ok: false, error: "请选择能力证明类型" };
	if (!proofRef) return { ok: false, error: "请填写证明编号/引用（如工号、设备码、推荐人）" };
	if (reason.length < 10) return { ok: false, error: "申请理由至少 10 个字（太短无法判断）" };

	// 同一时刻只允许一张待审申请：否则同一人可堆多张，审批人重复劳动，
	// 且批准顺序不同会得到不同结果（第二张变陈旧申请）。
	const dup = getDb()
		.prepare("SELECT id FROM role_requests WHERE user_id = ? AND status = 'pending'")
		.get(user.id ?? -1) as unknown as { id: string } | undefined;
	if (dup) return { ok: false, error: "你已有一张待审核的申请，请等待处理或先撤回" };

	const id = genId();
	const ts = nowIso();
	getDb()
		.prepare(
			`INSERT INTO role_requests
			 (id, user_id, username, from_role, from_level, target_role, target_level,
			  real_name, contact, proof_type, proof_ref, class_name, grade_name,
			  reason, evidence, status, reviewer, review_note, created_at, reviewed_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '', '', ?, NULL)`
		)
		.run(
			id,
			user.id ?? -1,
			user.username,
			fromRole,
			fromLevel,
			target,
			targetLevelOf(target),
			realName,
			contact.slice(0, 120),
			proofType,
			proofRef.slice(0, 200),
			String(input.className ?? user.className ?? "").trim().slice(0, 64),
			String(input.gradeName ?? user.gradeName ?? "").trim().slice(0, 64),
			reason.slice(0, 2000),
			evidence.slice(0, 2000),
			ts
		);

	const row = getDb().prepare("SELECT * FROM role_requests WHERE id = ?").get(id) as unknown as Row;
	return { ok: true, request: toRequest(row) };
}

// ── 查询 ────────────────────────────────────────────────────────────────────

export function listRoleRequests(status?: string): RoleRequest[] {
	const db = getDb();
	const rows = status
		? (db.prepare("SELECT * FROM role_requests WHERE status = ? ORDER BY created_at DESC").all(status) as unknown as Row[])
		: (db.prepare("SELECT * FROM role_requests ORDER BY created_at DESC").all() as unknown as Row[]);
	return rows.map(toRequest);
}

export function listMyRoleRequests(username: string): RoleRequest[] {
	const rows = getDb()
		.prepare("SELECT * FROM role_requests WHERE username = ? ORDER BY created_at DESC LIMIT 20")
		.all(username) as unknown as Row[];
	return rows.map(toRequest);
}

export function getRoleRequest(id: string): RoleRequest | null {
	const row = getDb().prepare("SELECT * FROM role_requests WHERE id = ?").get(id) as unknown as Row | undefined;
	return row ? toRequest(row) : null;
}

/** 撤回自己的待审申请。 */
export function cancelRoleRequest(id: string, username: string): { ok: boolean; error?: string } {
	const req = getRoleRequest(id);
	if (!req) return { ok: false, error: "申请不存在" };
	if (req.username !== username) return { ok: false, error: "只能撤回自己的申请" };
	if (req.status !== "pending") return { ok: false, error: "只有待审核的申请可以撤回" };
	getDb()
		.prepare("UPDATE role_requests SET status = 'cancelled', reviewed_at = ? WHERE id = ?")
		.run(nowIso(), id);
	return { ok: true };
}

// ── 审批 ────────────────────────────────────────────────────────────────────

/**
 * 审批一张申请。
 *
 * @param reviewer 审批人（username）—— 其等级会被重新读库校验，不信任调用方传来的等级
 */
export function reviewRoleRequest(
	id: string,
	action: "approve" | "reject",
	reviewer: string,
	note = ""
): { ok: boolean; error?: string; request?: RoleRequest } {
	const req = getRoleRequest(id);
	if (!req) return { ok: false, error: "申请不存在" };
	if (req.status !== "pending") return { ok: false, error: "该申请已处理过（当前状态：" + req.status + "）" };

	const rv = getUser(reviewer);
	if (!rv) return { ok: false, error: "审批人不存在" };

	// 规则 2：审批人须持 reviewPermission，且**严格高于**目标等级。
	if (!userCan(rv, "reviewPermission")) {
		return { ok: false, error: "无权审批权限申请" };
	}
	const rvLevel = roleToLevel(rv.role as Role) ?? 0;
	if (rvLevel <= req.targetLevel) {
		return {
			ok: false,
			error: `审批人等级（L${rvLevel}）须高于目标等级（L${req.targetLevel}），否则等于自行放权`
		};
	}
	// 不能审自己：一是利益冲突，二是配合「严格高于」会形成自升链。
	if (rv.username === req.username) return { ok: false, error: "不能审批自己的申请" };

	const db = getDb();
	const ts = nowIso();

	if (action === "reject") {
		db.prepare(
			"UPDATE role_requests SET status = 'rejected', reviewer = ?, review_note = ?, reviewed_at = ? WHERE id = ?"
		).run(rv.username, String(note || "").slice(0, 500), ts, id);
		return { ok: true, request: getRoleRequest(id) as RoleRequest };
	}

	// 规则 3：陈旧申请不执行。
	const applicant = getUser(req.username);
	if (!applicant) return { ok: false, error: "申请人账号已不存在" };
	if ((applicant.role as string) !== req.fromRole) {
		db.prepare(
			"UPDATE role_requests SET status = 'rejected', reviewer = ?, review_note = ?, reviewed_at = ? WHERE id = ?"
		).run(
			rv.username,
			`陈旧申请：申请人当前角色已为 ${applicant.role}（申请时为 ${req.fromRole}），拒绝自动改角色`.slice(0, 500),
			ts,
			id
		);
		return { ok: false, error: "申请已过期：申请人角色在等待期间发生变化，请让其重新提交" };
	}

	// 改角色走既有的 adminUpdateUser（它内含「内置 admin 不可降级」等保护）。
	const res = adminUpdateUser(req.username, { role: req.targetRole as Role });
	if (!res.ok) return { ok: false, error: res.error || "角色更新失败" };

	db.prepare(
		"UPDATE role_requests SET status = 'approved', reviewer = ?, review_note = ?, reviewed_at = ? WHERE id = ?"
	).run(rv.username, String(note || "").slice(0, 500), ts, id);

	return { ok: true, request: getRoleRequest(id) as RoleRequest };
}

/** 待审数量（后台侧栏角标用）。 */
export function pendingRoleRequestCount(): number {
	const row = getDb().prepare("SELECT COUNT(*) AS n FROM role_requests WHERE status = 'pending'").get() as
		| { n: number }
		| undefined;
	return Number(row?.n ?? 0);
}
