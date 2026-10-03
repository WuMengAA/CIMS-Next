import { json } from "@sveltejs/kit";
import { listItems, getItem, saveItem, deleteItem, reorderItems, renderMarkdown, getTags, getCategories, getFolders } from "$lib/server/content-store.js";
import { getApiUser, canManage, canManageOrPublic } from "$lib/server/api-auth.js";


export async function GET({ url, request }) {
	const user = getApiUser(request);
	const action = url.searchParams.get("action");
	if (action === "get") {
		const slug = url.searchParams.get("slug");
		if (!slug) return json({ error: "slug required" }, { status: 400 });
		const item = getItem("docs", slug);
		if (!item) return json({ error: "not found" }, { status: 404 });
		return json(item);
	}
	if (action === "tags") return json(getTags("docs"));
	if (action === "categories") return json(getCategories("docs"));
	if (action === "folders") return json(getFolders("docs"));
	const status = url.searchParams.get("status");
	let items = listItems("docs").filter(p => canManageOrPublic(user, p.owner));
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
		return json(saveItem("docs", { ...body, owner }));
	}
	if (action === "delete") {
		if (!user) return json({ error: "未登录" }, { status: 401 });
		const target = getItem("docs", body.slug);
		if (!target) return json({ ok: false }, { status: 404 });
		if (!canManage(user, target.owner)) return json({ error: "无权删除他人内容" }, { status: 403 });
		return json({ ok: deleteItem("docs", body.slug) });
	}
	if (action === "reorder") {
		// T12（2026-10-03）：同 posts。
		if (!canManage(user)) return json({ error: "仅站长可全局排序" }, { status: 403 });
		reorderItems("docs", body.orderedSlugs); return json({ ok: true });
	}
	return json({ error: "unknown action" }, { status: 400 });
}

export async function PUT({ request }) {
	const body = await request.json();
	const rendered = renderMarkdown(body.body || "");
	return json({ html: rendered.html });
}