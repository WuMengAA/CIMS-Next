/** POST /api/library/folder —— 新建目录。parentId 必须属于当前用户，否则一律拒（防越权建目录）。 */
import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { sessionUser } from "$lib/server/session.js";
import { recordActivity } from "$lib/server/activity.js";
import { listFolders, createFolder } from "$lib/server/attachment-library.js";

export async function POST(event: RequestEvent) {
	const user = sessionUser(event);
	if (!user) return json({ error: "未登录" }, { status: 401 });

	const form = await event.request.formData().catch(() => null);
	if (!form) return json({ error: "请求体不是表单" }, { status: 400 });

	const parentRaw = form.get("parentId");
	const parentId = parentRaw ? String(parentRaw) : null;
	if (parentId) {
		const mine = listFolders(user.id).some((f) => f.id === parentId);
		if (!mine) return json({ error: "目标目录不存在" }, { status: 400 });
	}

	const folder = createFolder(user.id, String(form.get("name") ?? ""), parentId);
	recordActivity({ userId: user.id, username: user.username, action: "other", target: `folder:${folder.name}` });
	return json({ ok: true, folder });
}
