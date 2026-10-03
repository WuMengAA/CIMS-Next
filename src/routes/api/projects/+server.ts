import { json } from "@sveltejs/kit";
import { listItems, getItem, saveItem, deleteItem, reorderItems, getTags, getCategories } from "$lib/server/content-store.js";
import { getApiUser, canManage, canManageOrPublic } from "$lib/server/api-auth.js";


export async function GET({ url, request }) {
	const user = getApiUser(request);
	const action = url.searchParams.get("action");
	if (action === "get") {
		const slug = url.searchParams.get("slug");
		if (!slug) return json({ error: "slug required" }, { status: 400 });
		const item = getItem("projects", slug);
		if (!item) return json({ error: "not found" }, { status: 404 });
		return json(item);
	}
	if (action === "tags") return json(getTags("projects"));
	if (action === "categories") return json(getCategories("projects"));
	const status = url.searchParams.get("status");
	let items = listItems("projects").filter(p => canManageOrPublic(user, p.owner));
	if (status) items = items.filter(i => i.status === status);
	return json(items);
}

export async function POST({ request }) {
	const user = getApiUser(request);
	const action = request.headers.get("x-action");
	const body = await request.json();
	if (action === "save") {
		if (!user) return json({ error: "未登录" }, { status: 401 });
		// T12（2026-10-03）：见 posts/+server.ts 的等价性说明 —— 第二个实参 body.owner
		// 不能省，否则编辑员保存自己新建内容会被一并挡掉（顺手改语义，违反验收③）。
		if (!canManage(user, body.owner)) return json({ error: "无内容管理权限" }, { status: 403 });
		const owner = body.owner ? body.owner : user.username;
		return json(saveItem("projects", { ...body, owner }));
	}
	if (action === "delete") {
		if (!user) return json({ error: "未登录" }, { status: 401 });
		const target = getItem("projects", body.slug);
		if (!target) return json({ ok: false }, { status: 404 });
		if (!canManage(user, target.owner)) return json({ error: "无权删除他人内容" }, { status: 403 });
		return json({ ok: deleteItem("projects", body.slug) });
	}
	if (action === "reorder") {
		// T12（2026-10-03）：原判 `user.role !== "admin"`，四处内容端点统一改 canManage
		// （admin 通过不变、owner 新放行、editor/moderator 仍 403）。
		if (!canManage(user)) return json({ error: "仅站长可全局排序" }, { status: 403 });
		reorderItems("projects", body.orderedSlugs); return json({ ok: true });
	}
	return json({ error: "unknown action" }, { status: 400 });
}