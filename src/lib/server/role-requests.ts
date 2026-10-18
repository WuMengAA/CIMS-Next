/**
 * 权限晋升申请（#181）—— 「申请 + 能力证明 + 逐级审批」的服务端实现。
 *
 * ## 为什么需要它
 *
 * 角色/权限此前只能由管理员在「用户管理」里**直接改角色**：
 * 没有人知道「这人凭什么该进集控」。本模块把这条链路显式化 ——
 *
 *   低秩位用户提交申请（附能力证明）→ 高秩位用户批准 → 角色升级
 *
 * ## 三条硬规则（都在服务端，前端只是提示）
 *
 * 1. **逐级晋升**：目标角色秩必须恰好是当前角色秩 + 1。不能 秩2 直接申 秩5 审核员 ——
 *    否则「能力证明」无从证明（学生拿不出审核履历），审核权会在一步之内被套走。
 *    秩按 `ROLE_RANK`（permissions.ts）判定；**与经验等级（xp→Lv）无关**（#248 解耦）。
 * 2. **审批人必须严格高于目标角色秩**（`reviewerRank > targetRank`）。只校验
 *    `can(reviewPermission)` 是不够的：该称号授予 秩5 审核员，于是 秩5 审核员能批准
 *    「升到 秩5」的申请 —— 等于自己给自己发审核权。要求严格大于之后，
 *    秩3/秩4 由 秩5 批、秩5 只能由 秩6 批。
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
import { can, userCan, roleRank, ROLE_LABELS, PROOF_TYPES, PROOF_TYPE_KEYS } from "$lib/permissions.js";
import type { Role } from "$lib/permissions.js";

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
// 每个「角色秩」（1–6，见 permissions.ts ROLE_RANK）对应「该秩的代表角色」。
// 秩 5 有**两个**职能岗（审核员 / 编辑），二者秩相同但广播范围不同
// （本年级 / 全校），因此申请时要显式二选一，不能替申请人猜 —— 猜错等于默默给了全校广播权。
//
// 秩 6（站长）**不开放申请**：现任站长直接指派，避免「申请 → 审批」在最高层
// 自我循环（按规则 2，没有任何角色能批准秩 6）。
//
// ⚠️ #248：这里的「秩」是权限链上的高低，与「经验等级（xp→Lv）」完全无关。
//    等级只是展示，晋升只按角色秩走。数据库 from_level/target_level 列存的也是秩。
const PROMOTION_ROLES: Record<number, Role[]> = {
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

/** 当前角色可申请的目标角色清单（逐级：只有上一秩的角色）。 */
export function applicableTargets(fromRole: Role | string | null | undefined): Role[] {
	const rank = roleRank((fromRole ?? null) as Role | null);
	if (rank <= 0) return [];
	if (rank >= 6) return [];
	return PROMOTION_ROLES[rank + 1] ?? [];
}

/**
 * 供界面/接口下发的目标清单（带中文标签与角色秩）。
 *
 * 页面 load 与 `/api/role-requests?scope=mine` **必须**共用这一个函数 ——
 * 否则两处会各自拼一份：曾经接口下发裸字符串 `["techrep"]`、页面下发富对象，
 * 前端拿同一个字段却要按两种形状解析（谁先改谁就悄悄把对方打挂）。
 */
export function targetOptions(fromRole: Role | string | null | undefined): {
	role: Role;
	label: string;
	rank: number;
}[] {
	return applicableTargets(fromRole).map((t) => ({
		role: t,
		label: ROLE_LABELS[t],
		rank: roleRank(t)
	}));
}

/** 目标角色 -> 角色秩（申请时服务端自行推导，**不信任前端传来的秩**）。 */
function targetRankOf(role: string): number {
	return roleRank(role as Role);
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

export async function submitRoleRequest(input: SubmitInput): Promise<{ ok: true; request: RoleRequest } | { ok: false; error: string }> {
	const user = await getUser(input.username);
	if (!user) return { ok: false, error: "用户不存在" };

	const fromRole = user.role as Role;
	const fromRank = roleRank(fromRole);
	if (fromRank <= 0) return { ok: false, error: "当前账号角色异常，无法申请" };

	const targets = applicableTargets(fromRole);
	if (targets.length === 0) {
		return {
			ok: false,
			error:
				fromRank >= 6
					? "已是最高权限档（站长），无需申请"
					: "当前角色无可申请的晋升目标"
		};
	}
	const target = String(input.targetRole || "").trim();
	if (!targets.includes(target as Role)) {
		// 把可选清单一并回给调用方，前端提示才具体（"只能申电教委员"）。
		return {
			ok: false,
			error: `只允许逐级晋升：当前 ${ROLE_LABELS[fromRole] ?? fromRole}，可申请 ${targets
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
	const dup = await getDb()
		.prepare("SELECT id FROM role_requests WHERE user_id = ? AND status = 'pending'")
		.get(user.id ?? -1) as unknown as { id: string } | undefined;
	if (dup) return { ok: false, error: "你已有一张待审核的申请，请等待处理或先撤回" };

	const id = genId();
	const ts = nowIso();
	await getDb()
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
			fromRank,
			target,
			targetRankOf(target),
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

	const row = await getDb().prepare("SELECT * FROM role_requests WHERE id = ?").get(id) as unknown as Row;
	return { ok: true, request: toRequest(row) };
}

// ── 查询 ────────────────────────────────────────────────────────────────────

export async function listRoleRequests(status?: string): Promise<RoleRequest[]> {
	const db = getDb();
	const rows = status
		? (await db.prepare("SELECT * FROM role_requests WHERE status = ? ORDER BY created_at DESC").all(status) as unknown as Row[])
		: (await db.prepare("SELECT * FROM role_requests ORDER BY created_at DESC").all() as unknown as Row[]);
	return rows.map(toRequest);
}

export async function listMyRoleRequests(username: string): Promise<RoleRequest[]> {
	const rows = await getDb()
		.prepare("SELECT * FROM role_requests WHERE username = ? ORDER BY created_at DESC LIMIT 20")
		.all(username) as unknown as Row[];
	return rows.map(toRequest);
}

export async function getRoleRequest(id: string): Promise<RoleRequest | null> {
	const row = await getDb().prepare("SELECT * FROM role_requests WHERE id = ?").get(id) as unknown as Row | undefined;
	return row ? toRequest(row) : null;
}

/** 撤回自己的待审申请。 */
export async function cancelRoleRequest(id: string, username: string): Promise<{ ok: boolean; error?: string }> {
	const req = await getRoleRequest(id);
	if (!req) return { ok: false, error: "申请不存在" };
	if (req.username !== username) return { ok: false, error: "只能撤回自己的申请" };
	if (req.status !== "pending") return { ok: false, error: "只有待审核的申请可以撤回" };
	await getDb()
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
export async function reviewRoleRequest(
	id: string,
	action: "approve" | "reject",
	reviewer: string,
	note = ""
): Promise<{ ok: boolean; error?: string; request?: RoleRequest }> {
	const req = await getRoleRequest(id);
	if (!req) return { ok: false, error: "申请不存在" };
	if (req.status !== "pending") return { ok: false, error: "该申请已处理过（当前状态：" + req.status + "）" };

	const rv = await getUser(reviewer);
	if (!rv) return { ok: false, error: "审批人不存在" };

	// 规则 2：审批人须持 reviewPermission，且**严格高于**目标角色秩。
	if (!userCan(rv, "reviewPermission")) {
		return { ok: false, error: "无权审批权限申请" };
	}
	const rvRank = roleRank(rv.role as Role);
	if (rvRank <= req.targetLevel) {
		return {
			ok: false,
			error: `审批人角色秩（${rvRank}）须高于目标角色秩（${req.targetLevel}），否则等于自行放权`
		};
	}
	// 不能审自己：一是利益冲突，二是配合「严格高于」会形成自升链。
	if (rv.username === req.username) return { ok: false, error: "不能审批自己的申请" };

	const db = getDb();
	const ts = nowIso();

	if (action === "reject") {
		await db.prepare(
			"UPDATE role_requests SET status = 'rejected', reviewer = ?, review_note = ?, reviewed_at = ? WHERE id = ?"
		).run(rv.username, String(note || "").slice(0, 500), ts, id);
		return { ok: true, request: await getRoleRequest(id) as RoleRequest };
	}

	// 规则 3：陈旧申请不执行。
	const applicant = await getUser(req.username);
	if (!applicant) return { ok: false, error: "申请人账号已不存在" };
	if ((applicant.role as string) !== req.fromRole) {
		await db.prepare(
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
	const res = await adminUpdateUser(req.username, { role: req.targetRole as Role });
	if (!res.ok) return { ok: false, error: res.error || "角色更新失败" };

	await db.prepare(
		"UPDATE role_requests SET status = 'approved', reviewer = ?, review_note = ?, reviewed_at = ? WHERE id = ?"
	).run(rv.username, String(note || "").slice(0, 500), ts, id);

	return { ok: true, request: await getRoleRequest(id) as RoleRequest };
}

/** 待审数量（后台侧栏角标用）。 */
export async function pendingRoleRequestCount(): Promise<number> {
	const row = await getDb().prepare("SELECT COUNT(*) AS n FROM role_requests WHERE status = 'pending'").get() as
		| { n: number }
		| undefined;
	return Number(row?.n ?? 0);
}
