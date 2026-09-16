import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { recordView, getStatsSummary } from "$lib/server/content-store.js";
import { verifyToken } from "$lib/server/auth.js";
import { can } from "$lib/permissions.js";

export const POST: RequestHandler = async ({ request }) => {
	let body: { target?: string } = {};
	try { body = await request.json(); } catch { /* ignore */ }
	const target = body.target?.trim();
	if (!target) return json({ error: "缺少 target" }, { status: 400 });
	const total = recordView(target);
	return json({ ok: true, total });
};

export const GET: RequestHandler = async ({ cookies, url }) => {
	const u = verifyToken(cookies.get("admin_token"));
	if (!u || !can(u.role, "viewAdmin")) return json({ error: "无权限" }, { status: 403 });
	const days = Math.min(30, Math.max(1, parseInt(url.searchParams.get("days") || "7", 10) || 7));
	return json(getStatsSummary(days));
};
