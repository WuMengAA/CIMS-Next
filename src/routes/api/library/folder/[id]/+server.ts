/**
 * /api/library/folder/[id] —— 重命名 / 删除目录。
 * 目录 id 不带 owner 过滤就是越权入口，所以 PATCH/DELETE 都强制带上 owner_id。
 */
import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { sessionUser } from "$lib/server/session.js";
import { recordActivity } from "$lib/server/activity.js";
import { renameFolder, deleteFolderDeep } from "$lib/server/attachment-library.js";

export async function PATCH(event: RequestEvent) {
	const user = sessionUser(event);
	if (!user) return json({ error: "未登录" }, { status: 401 });
	const id = event.params.id ?? "";
	const body = await event.request.json().catch(() => ({}));
	const name = String((body as { name?: string }).name ?? "").trim();
	if (!name) return json({ error: "目录名不能为空" }, { status: 400 });
	renameFolder(user.id, id, name);
	recordActivity({ userId: user.id, username: user.username, action: "other", target: `folder-rename:${name}` });
	return json({ ok: true });
}

/** 删除目录：里面所有文件与子目录一起清掉，R2 对象同步删除（不可恢复）。 */
export async function DELETE(event: RequestEvent) {
	const user = sessionUser(event);
	if (!user) return json({ error: "未登录" }, { status: 401 });
	const id = event.params.id ?? "";
	const removed = await deleteFolderDeep(user.id, id);
	recordActivity({ userId: user.id, username: user.username, action: "other", target: `folder-delete:${removed} files` });
	return json({ ok: true, removedFiles: removed });
}
