/**
 * 权限晋升申请 API（#181）。
 *
 *   GET  /api/role-requests?scope=mine        我的申请 + 我可申请的目标 + 证明类型
 *   GET  /api/role-requests?scope=review      待审/全部申请（需 reviewPermission）
 *   GET  /api/role-requests?scope=pending-count  待审数量（后台角标）
 *   POST /api/role-requests  {action:"submit"}   提交申请
 *   POST /api/role-requests  {action:"cancel"}   撤回自己的待审申请
 *   POST /api/role-requests  {action:"approve"|"reject", id, note}  审批（需 reviewPermission）
 *
 * ⚠️ 与 `api/link-applications` 的关键差异：**审批动作在这里做权限校验**。
 * 那边的 POST approve 只校验「已登录」，任何登录用户都能批准友链申请 ——
 * 本端点不沿用该写法：审批前必须过 `can(role, "reviewPermission")`，
 * 且由 `reviewRoleRequest` 再校验「审批人等级严格高于目标等级」。
 */

import { json } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { can } from "$lib/permissions.js";
import {
	submitRoleRequest,
	listRoleRequests,
	listMyRoleRequests,
	reviewRoleRequest,
	cancelRoleRequest,
	targetOptions,
	pendingRoleRequestCount,
	PROOF_TYPES
} from "$lib/server/role-requests.js";

function currentUser(request: Request, cookies: { get: (n: string) => string | undefined }) {
	const token = cookies.get("admin_token") || request.headers.get("cookie")?.match(/admin_token=([^;]+)/)?.[1] || "";
	return verifyToken(token);
}

export async function GET({ url, request, cookies }) {
	const user = currentUser(request, cookies);
	if (!user) return json({ error: "未登录" }, { status: 401 });
	const scope = url.searchParams.get("scope") || "mine";

	if (scope === "mine") {
		return json({
			requests: listMyRoleRequests(user.username),
			// 与 `/apply/role` 的页面 load 共用 targetOptions()：形状必须一致，
			// 否则同一字段在两处解析方式不同（详见 role-requests.ts 注释）。
			targets: targetOptions(user.role),
			proofTypes: PROOF_TYPES
		});
	}

	if (scope === "pending-count") {
		// 角标只对能审的人有意义；无权者一律返回 0，避免泄露待办规模。
		if (!can(user.role, "reviewPermission")) return json({ count: 0, canReview: false });
		return json({ count: pendingRoleRequestCount(), canReview: true });
	}

	// scope=review：审批队列
	if (!can(user.role, "reviewPermission")) return json({ error: "无权查看权限申请" }, { status: 403 });
	const status = url.searchParams.get("status") || "pending";
	return json({ requests: status === "all" ? listRoleRequests() : listRoleRequests(status) });
}

export async function POST({ request, cookies }) {
	const user = currentUser(request, cookies);
	if (!user) return json({ error: "未登录" }, { status: 401 });

	let body: Record<string, unknown> = {};
	try {
		body = await request.json();
	} catch {
		return json({ error: "请求体不是合法 JSON" }, { status: 400 });
	}
	const action = String(body.action || "submit");

	if (action === "submit") {
		const r = submitRoleRequest({
			username: user.username,
			targetRole: String(body.targetRole || ""),
			realName: body.realName as string,
			contact: body.contact as string,
			proofType: body.proofType as string,
			proofRef: body.proofRef as string,
			className: body.className as string,
			gradeName: body.gradeName as string,
			reason: body.reason as string,
			evidence: body.evidence as string
		});
		if (!r.ok) return json({ error: r.error }, { status: 400 });
		return json({ ok: true, request: r.request });
	}

	if (action === "cancel") {
		const r = cancelRoleRequest(String(body.id || ""), user.username);
		if (!r.ok) return json({ error: r.error }, { status: 400 });
		return json({ ok: true });
	}

	if (action === "approve" || action === "reject") {
		// 这里先做一次粗门控（快速失败、语义清晰）；细规则（严格高于目标等级、
		// 不许审自己、陈旧申请）在 reviewRoleRequest 内统一执行。
		if (!can(user.role, "reviewPermission")) {
			return json({ error: "无权审批权限申请" }, { status: 403 });
		}
		const r = reviewRoleRequest(
			String(body.id || ""),
			action,
			user.username,
			String(body.note || "")
		);
		if (!r.ok) return json({ error: r.error }, { status: 400 });
		return json({ ok: true, request: r.request });
	}

	return json({ error: "unknown action" }, { status: 400 });
}
