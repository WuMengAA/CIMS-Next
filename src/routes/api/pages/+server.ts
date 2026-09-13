import { json } from "@sveltejs/kit";
import { listItems, getItem, saveItem, deleteItem, reorderItems, renderMarkdown, getFolders } from "$lib/server/content-store.js";
import { getApiUser, canManage } from "$lib/server/api-auth.js";

export async function GET({ url, request }: { url: URL; request: Request }) {
	const user = getApiUser(request);
	const action = url.searchParams.get("action");
	if (action === "get") {
		const slug = url.searchParams.get("slug");
		if (!slug) return json({ error: "slug required" }, { status: 400 });
		const item = getItem("pages", slug);
		if (!item) return json({ error: "not found" }, { status: 404 });
		return json(item);
	}
	if (action === "folders") return json(getFolders("pages"));
	const status = url.searchParams.get("status");
	let items = listItems("pages").filter((p) => canManage(user, p.owner));
	if (status) items = items.filter((i) => i.status === status);
	return json(items);
}

export async function POST({ request }: { request: Request }) {
	const user = getApiUser(request);
	const action = request.headers.get("x-action");
	const body = await request.json();
	if (action === "save") {
		if (!user) return json({ error: "未登录" }, { status: 401 });
		if (user.role !== "admin" && body.owner && body.owner !== user.username) {
			return json({ error: "无权操作他人内容" }, { status: 403 });
		}
		const owner = user.role === "admin" && body.owner ? body.owner : user.username;
		return json(saveItem("pages", { ...body, owner }));
	}
	if (action === "delete") {
		if (!user) return json({ error: "未登录" }, { status: 401 });
		const target = getItem("pages", body.slug);
		if (!target) return json({ ok: false }, { status: 404 });
		if (!canManage(user, target.owner)) return json({ error: "无权删除他人内容" }, { status: 403 });
		return json({ ok: deleteItem("pages", body.slug) });
	}
	if (action === "reorder") {
		if (!user || user.role !== "admin") return json({ error: "仅管理员可全局排序" }, { status: 403 });
		reorderItems("pages", body.orderedSlugs);
		return json({ ok: true });
	}
	return json({ error: "unknown action" }, { status: 400 });
}

export async function PUT({ request }) {
	const body = await request.json();
	const rendered = renderMarkdown(body.body || "");
	return json({ html: rendered.html });
}
