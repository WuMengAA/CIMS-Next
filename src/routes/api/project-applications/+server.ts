import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getProjectApplications, addProjectApplication, setProjectApplicationStatus } from "$lib/server/content-store.js";
import { verifyToken } from "$lib/server/auth.js";
import { can } from "$lib/permissions.js";

export const GET: RequestHandler = async ({ cookies, url }) => {
	const u = verifyToken(cookies.get("admin_token"));
	if (!u || !can(u.role, "moderate")) return json({ error: "无权限" }, { status: 403 });
	const status = url.searchParams.get("status") || undefined;
	return json(getProjectApplications(status));
};

export const POST: RequestHandler = async ({ request, cookies }) => {
	let body: any = {};
	try { body = await request.json(); } catch { return json({ error: "请求体错误" }, { status: 400 }); }

	// 管理员操作：审核
	if (body.action === "approve" || body.action === "reject") {
		const u = verifyToken(cookies.get("admin_token"));
		if (!u || !can(u.role, "moderate")) return json({ error: "无权限" }, { status: 403 });
		const status = body.action === "approve" ? "approved" : "rejected";
		const app = setProjectApplicationStatus(body.id, status, body.makePage === true);
		if (!app) return json({ error: "申请不存在" }, { status: 404 });
		return json({ ok: true, app });
	}

	// 普通登录用户：提交申请
	const u = verifyToken(cookies.get("admin_token"));
	if (!u) return json({ error: "请先登录" }, { status: 401 });
	if (!body.name?.trim() || !body.summary?.trim()) return json({ error: "请填写名称与简介" }, { status: 400 });
	const app = addProjectApplication({
		name: String(body.name).slice(0, 80),
		summary: String(body.summary).slice(0, 500),
		repo: body.repo ? String(body.repo).slice(0, 300) : undefined,
		website: body.website ? String(body.website).slice(0, 300) : undefined,
		category: body.category ? String(body.category).slice(0, 40) : undefined,
		owner: u.username
	});
	return json({ ok: true, id: app.id, status: app.status });
};
