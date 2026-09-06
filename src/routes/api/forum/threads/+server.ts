import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getForumThreads, addForumThread, getForumChannels } from "$lib/server/content-store.js";
import { verifyToken } from "$lib/server/auth.js";

export const GET: RequestHandler = async ({ url }) => {
	const channel = url.searchParams.get("channel");
	const threads = getForumThreads(channel || undefined).map(t => ({
		id: t.id,
		channelId: t.channelId,
		title: t.title,
		author: t.author,
		authorRole: t.authorRole,
		createdAt: t.createdAt,
		status: t.status,
		pinned: !!t.pinned,
		views: t.views,
		lastReplyAt: t.lastReplyAt,
		excerpt: t.body.replace(/[#*`>\[\]()!|-]/g, "").replace(/\s+/g, " ").trim().slice(0, 140)
	}));
	return json(threads);
};

export const POST: RequestHandler = async ({ request, cookies }) => {
	const u = verifyToken(cookies.get("admin_token"));
	if (!u) return json({ error: "请先登录" }, { status: 401 });
	let body: any = {};
	try { body = await request.json(); } catch { return json({ error: "请求体错误" }, { status: 400 }); }
	if (!body.channelId || !body.title?.trim() || !body.body?.trim()) {
		return json({ error: "请填写频道、标题与内容" }, { status: 400 });
	}
	// channelId 可以是频道 id 或 slug
	const ch = getForumChannels().find(c => c.id === String(body.channelId) || c.slug === String(body.channelId));
	if (!ch) return json({ error: "频道不存在" }, { status: 400 });
	const t = addForumThread({
		channelId: ch.id,
		title: String(body.title).slice(0, 120),
		body: String(body.body).slice(0, 5000),
		author: u.username,
		authorRole: u.role
	});
	return json({ ok: true, thread: t });
};
