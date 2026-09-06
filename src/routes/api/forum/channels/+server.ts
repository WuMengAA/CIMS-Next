import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getForumChannels, addForumChannel } from "$lib/server/content-store.js";
import { verifyToken } from "$lib/server/auth.js";

export const GET: RequestHandler = async () => json(getForumChannels());

export const POST: RequestHandler = async ({ request, cookies }) => {
	const u = verifyToken(cookies.get("admin_token"));
	if (!u) return json({ error: "请先登录" }, { status: 401 });
	let body: any = {};
	try { body = await request.json(); } catch { return json({ error: "请求体错误" }, { status: 400 }); }
	if (!body.name?.trim()) return json({ error: "请填写频道名称" }, { status: 400 });
	const ch = addForumChannel({
		name: String(body.name).slice(0, 60),
		description: body.description ? String(body.description).slice(0, 300) : undefined,
		owner: u.username
	});
	return json({ ok: true, channel: ch });
};
