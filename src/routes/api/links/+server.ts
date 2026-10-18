import { json } from "@sveltejs/kit";
import { getLinks, saveLinks } from "$lib/server/content-store.js";
import { getApiUser } from "$lib/server/api-auth.js";
import { can } from "$lib/permissions.js";

export function GET() {
	return json(getLinks());
}

export async function POST({ request }) {
	const user = await getApiUser(request);
	if (!user) return json({ error: "未登录" }, { status: 401 });
	// T11（2026-10-03）：原先只判「已登录」—— 任何 viewer 都能整站覆盖友链。
	// 全站友链属于内容轴；提交友链申请走 /api/link-applications（公开投稿），此处是后台批量覆盖。
	if (!can(user.role, "manageContent")) return json({ error: "无权管理友链" }, { status: 403 });
	const action = request.headers.get("x-action");
	const body = await request.json();
	if (action === "save") {
		saveLinks(body.links || []);
		return json({ ok: true });
	}
	return json({ error: "unknown action" }, { status: 400 });
}