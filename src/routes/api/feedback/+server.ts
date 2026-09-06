import { json } from "@sveltejs/kit";
import { getFeedback, getFeedbackById, addFeedback, setFeedbackStatus, addFeedbackReply, deleteFeedback } from "$lib/server/content-store.js";
import { verifyToken } from "$lib/server/auth.js";
import { can } from "$lib/permissions.js";

// GET /api/feedback  → 公开：全部反馈（issue 列表天然公开，类似 GitHub）
// ?status=open → 按状态过滤
export function GET({ url }) {
	const status = url.searchParams.get("status") as any;
	return json(getFeedback(status ? { status } : {}));
}

// POST /api/feedback  → 提交反馈（需登录，user 及以上）
export async function POST({ request, cookies }) {
	const u = verifyToken(cookies.get("admin_token"));
	if (!u || !can(u.role, "submitFeedback")) return json({ error: "请先登录后再提交反馈" }, { status: 401 });
	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ error: "请求体无效" }, { status: 400 });
	}
	if (!body.title?.trim()) return json({ error: "标题不能为空" }, { status: 400 });
	if (!body.content?.trim()) return json({ error: "内容不能为空" }, { status: 400 });
	const item = addFeedback({
		title: body.title.trim(),
		content: body.content.trim(),
		author: u.displayName || u.username,
		authorRole: u.role,
		labels: Array.isArray(body.labels) ? body.labels.slice(0, 6) : []
	});
	return json(item, { status: 201 });
}

// PUT /api/feedback  → 改状态 / 官方回复（需审核权限）
export async function PUT({ request, cookies }) {
	const u = verifyToken(cookies.get("admin_token"));
	if (!u || !can(u.role, "moderate")) return json({ error: "无权限" }, { status: 403 });
	const body = await request.json();
	if (!body.id) return json({ error: "缺少 id" }, { status: 400 });
	if (body.content) {
		// 追加官方回复
		const updated = addFeedbackReply(body.id, { author: u.displayName || u.username, authorRole: u.role, content: body.content.trim() });
		return updated ? json(updated) : json({ error: "未找到" }, { status: 404 });
	}
	if (body.status) {
		const updated = setFeedbackStatus(body.id, body.status);
		return updated ? json(updated) : json({ error: "未找到" }, { status: 404 });
	}
	return json({ error: "无操作" }, { status: 400 });
}

// DELETE /api/feedback  → 删除反馈（需 manageContent）
export async function DELETE({ request, cookies }) {
	const u = verifyToken(cookies.get("admin_token"));
	if (!u || !can(u.role, "manageContent")) return json({ error: "无权限" }, { status: 403 });
	const body = await request.json();
	if (!body.id) return json({ error: "缺少 id" }, { status: 400 });
	return json({ ok: deleteFeedback(body.id) });
}
