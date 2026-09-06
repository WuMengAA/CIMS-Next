import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getDocCorrections, addDocCorrection, setDocCorrectionStatus } from "$lib/server/content-store.js";
import { verifyToken } from "$lib/server/auth.js";
import { can } from "$lib/permissions.js";

export const GET: RequestHandler = async ({ cookies, url }) => {
	const u = verifyToken(cookies.get("admin_token"));
	if (!u || !can(u.role, "moderate")) return json({ error: "无权限" }, { status: 403 });
	const status = url.searchParams.get("status") || undefined;
	return json(getDocCorrections(status));
};

export const POST: RequestHandler = async ({ request, cookies }) => {
	let body: any = {};
	try { body = await request.json(); } catch { return json({ error: "请求体错误" }, { status: 400 }); }

	if (body.action === "approve" || body.action === "reject") {
		const u = verifyToken(cookies.get("admin_token"));
		if (!u || !can(u.role, "moderate")) return json({ error: "无权限" }, { status: 403 });
		const c = setDocCorrectionStatus(body.id, body.action);
		if (!c) return json({ error: "纠错不存在" }, { status: 404 });
		return json({ ok: true, correction: c });
	}

	const u = verifyToken(cookies.get("admin_token"));
	if (!u) return json({ error: "请先登录" }, { status: 401 });
	if (!body.docSlug?.trim() || !body.suggestion?.trim()) return json({ error: "请填写文档与纠错建议" }, { status: 400 });
	const c = addDocCorrection({
		docSlug: String(body.docSlug).slice(0, 120),
		author: u.username,
		section: body.section ? String(body.section).slice(0, 120) : undefined,
		original: body.original ? String(body.original).slice(0, 2000) : undefined,
		suggestion: String(body.suggestion).slice(0, 2000),
		note: body.note ? String(body.note).slice(0, 500) : undefined
	});
	return json({ ok: true, id: c.id, status: c.status });
};
