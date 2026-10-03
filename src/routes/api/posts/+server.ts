import { json } from "@sveltejs/kit";
import { listItems, getItem, saveItem, deleteItem, reorderItems, renderMarkdown, getTags, getCategories } from "$lib/server/content-store.js";
import { getApiUser, canManage, canManageOrPublic } from "$lib/server/api-auth.js";


export async function GET({ url, request }) {
	const user = getApiUser(request);
	const action = url.searchParams.get("action");
	if (action === "get") {
		const slug = url.searchParams.get("slug");
		if (!slug) return json({ error: "slug required" }, { status: 400 });
		const item = getItem("posts", slug);
		if (!item) return json({ error: "not found" }, { status: 404 });
		return json(item);
	}
	if (action === "tags") return json(getTags("posts"));
	if (action === "categories") return json(getCategories("posts"));
	const status = url.searchParams.get("status");
	let items = listItems("posts").filter(p => canManageOrPublic(user, p.owner));
	if (status) items = items.filter(i => i.status === status);
	return json(items);
}

export async function POST({ request }) {
	const user = getApiUser(request);
	const action = request.headers.get("x-action");
	const body = await request.json();
	if (action === "save") {
		if (!user) return json({ error: "未登录" }, { status: 401 });
		// T12（2026-10-03）：原判 `role !== "admin"` 把站长(owner) 当普通用户 —— owner 与 admin
		// 同为 stationmaster，本应等价。这里改成 canManage(user, body.owner)，是**逐项等价**替换：
		//   admin  → 原通过，现通过（不变）
		//   owner  → 原被误拒，现通过（本次修正）
		//   编辑/普通用户保存**自己的**条目 → 原通过，现通过（不变）
		//   编辑/普通用户保存**别人的**条目 → 原 403，现 403（不变）
		// 注意第二个实参 body.owner 不能省：canManage(user) 在 owner 为空时对非站管一律 false，
		// 那会把编辑员保存自己新建内容一并挡掉，等于顺手改语义（违反验收③）。
		if (!canManage(user, body.owner)) return json({ error: "无内容管理权限" }, { status: 403 });
		const owner = body.owner ? body.owner : user.username;
		return json(saveItem("posts", { ...body, owner }));
	}
	if (action === "delete") {
		if (!user) return json({ error: "未登录" }, { status: 401 });
		const target = getItem("posts", body.slug);
		if (!target) return json({ ok: false }, { status: 404 });
		if (!canManage(user, target.owner)) return json({ error: "无权删除他人内容" }, { status: 403 });
		return json({ ok: deleteItem("posts", body.slug) });
	}
	if (action === "reorder") {
		// T12（2026-10-03）：排序是全站级内容整理，原判写死 admin → 改 canManage
		// （admin 通过不变、owner 新放行、editor/moderator 仍 403）。
		if (!canManage(user)) return json({ error: "仅站长可全局排序" }, { status: 403 });
		reorderItems("posts", body.orderedSlugs); return json({ ok: true });
	}
	return json({ error: "unknown action" }, { status: 400 });
}

export async function PUT({ request }) {
	const body = await request.json();
	const rendered = renderMarkdown(body.body || "");
	return json({ html: rendered.html });
}