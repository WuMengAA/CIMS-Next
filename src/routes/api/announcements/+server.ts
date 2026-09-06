import { json } from "@sveltejs/kit";
import { getAnnouncements, addAnnouncement, updateAnnouncement, deleteAnnouncement } from "$lib/server/content-store.js";
import { verifyToken } from "$lib/server/auth.js";
import { can } from "$lib/permissions.js";

// GET /api/announcements  → 公开：默认只返回“生效中”的公告
// ?all=1（需 manageContent）→ 后台：返回全部（含草稿/归档）
export function GET({ url, cookies }) {
	const all = url.searchParams.get("all") === "1";
	if (all) {
		const u = verifyToken(cookies.get("admin_token"));
		if (!u || !can(u.role, "manageContent")) return json({ error: "无权限" }, { status: 403 });
		return json(getAnnouncements());
	}
	return json(getAnnouncements({ activeOnly: true }));
}

// POST /api/announcements  → 新建公告（需 manageContent）
export async function POST({ request, cookies }) {
	const u = verifyToken(cookies.get("admin_token"));
	if (!u || !can(u.role, "manageContent")) return json({ error: "无权限" }, { status: 403 });
	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ error: "请求体无效" }, { status: 400 });
	}
	if (!body.title?.trim()) return json({ error: "标题不能为空" }, { status: 400 });
	const item = addAnnouncement({
		title: body.title.trim(),
		content: body.content || "",
		level: body.level || "info",
		status: body.status || "published",
		pinned: !!body.pinned,
		startsAt: body.startsAt || undefined,
		endsAt: body.endsAt || undefined
	});
	return json(item, { status: 201 });
}

// PUT /api/announcements  → 更新公告
export async function PUT({ request, cookies }) {
	const u = verifyToken(cookies.get("admin_token"));
	if (!u || !can(u.role, "manageContent")) return json({ error: "无权限" }, { status: 403 });
	const body = await request.json();
	if (!body.id) return json({ error: "缺少 id" }, { status: 400 });
	const updated = updateAnnouncement(body.id, {
		title: body.title, content: body.content, level: body.level, status: body.status, pinned: body.pinned, startsAt: body.startsAt, endsAt: body.endsAt
	});
	return updated ? json(updated) : json({ error: "未找到" }, { status: 404 });
}

// DELETE /api/announcements  → 删除公告
export async function DELETE({ request, cookies }) {
	const u = verifyToken(cookies.get("admin_token"));
	if (!u || !can(u.role, "manageContent")) return json({ error: "无权限" }, { status: 403 });
	const body = await request.json();
	if (!body.id) return json({ error: "缺少 id" }, { status: 400 });
	return json({ ok: deleteAnnouncement(body.id) });
}
