import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
	getForumThread,
	addForumReply,
	setForumThreadStatus,
	pinForumThread,
	incForumThreadViews,
	deleteForumThread
} from "$lib/server/content-store.js";
import { verifyToken } from "$lib/server/auth.js";
import { can } from "$lib/permissions.js";

export const GET: RequestHandler = async ({ params }) => {
	const { thread, replies } = getForumThread(params.id);
	if (!thread || (thread.status !== "published" && thread.status !== "locked")) {
		return json({ error: "主题不存在" }, { status: 404 });
	}
	incForumThreadViews(params.id);
	return json({ thread, replies });
};

export const POST: RequestHandler = async ({ request, cookies, params }) => {
	const u = verifyToken(cookies.get("admin_token"));
	let body: any = {};
	try { body = await request.json(); } catch { return json({ error: "请求体错误" }, { status: 400 }); }

	// 管理员操作：锁定 / 解锁 / 置顶 / 取消置顶 / 删除
	if (["lock", "unlock", "pin", "unpin", "delete"].includes(body.action)) {
		if (!u || !can(u.role, "moderate")) return json({ error: "无权限" }, { status: 403 });
		if (body.action === "delete") {
			deleteForumThread(params.id);
			return json({ ok: true });
		}
		if (body.action === "pin") return json({ ok: true, thread: pinForumThread(params.id, true) });
		if (body.action === "unpin") return json({ ok: true, thread: pinForumThread(params.id, false) });
		if (body.action === "lock") return json({ ok: true, thread: setForumThreadStatus(params.id, "locked") });
		if (body.action === "unlock") return json({ ok: true, thread: setForumThreadStatus(params.id, "published") });
	}

	// 登录用户回复
	if (!u) return json({ error: "请先登录" }, { status: 401 });
	if (!body.content?.trim()) return json({ error: "请填写回复内容" }, { status: 400 });
	const reply = addForumReply({
		threadId: params.id,
		author: u.username,
		authorRole: u.role,
		content: String(body.content).slice(0, 3000)
	});
	return json({ ok: true, reply });
};
