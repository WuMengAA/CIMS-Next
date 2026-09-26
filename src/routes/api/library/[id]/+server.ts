/** /api/library/[id] —— 改文件名 / 移动目录 / 切水印开关 / 删除。owner_id 强制过滤，跨账号一律查不到。 */
import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { sessionUser } from "$lib/server/session.js";
import { recordActivity } from "$lib/server/activity.js";
import { getFile, renameFile, moveFile, setFileWatermark, deleteFile } from "$lib/server/attachment-library.js";

/**
 * 路由参数在类型上是 `string | undefined`（rest 参数匹配不到就是 undefined）。
 * 这里统一收成 string：空 id 直接 404，不让 undefined 流进 SQL —— 那会变成 `WHERE id = NULL`，
 * 查不到任何行却也不报错，是最难排查的一类静默失败。
 */
function paramId(event: RequestEvent): string {
	return event.params.id ?? "";
}

export async function PATCH(event: RequestEvent) {
	const user = sessionUser(event);
	if (!user) return json({ error: "未登录" }, { status: 401 });
	const id = paramId(event);
	if (!id || !getFile(user.id, id)) return json({ error: "附件不存在" }, { status: 404 });

	const body = (await event.request.json().catch(() => ({}))) as Record<string, unknown>;

	if ("filename" in body) {
		const name = String(body.filename ?? "").trim();
		if (!name) return json({ error: "文件名不能为空" }, { status: 400 });
		renameFile(user.id, id, name);
	}
	if ("folderId" in body) {
		const fid = body.folderId == null || body.folderId === "" ? null : String(body.folderId);
		moveFile(user.id, id, fid);
	}
	if ("watermark" in body) {
		setFileWatermark(user.id, id, body.watermark === true || body.watermark === 1 || body.watermark === "1");
	}

	recordActivity({ userId: user.id, username: user.username, action: "other", target: `file-update:${id}` });
	return json({ ok: true, file: getFile(user.id, id) });
}

export async function DELETE(event: RequestEvent) {
	const user = sessionUser(event);
	if (!user) return json({ error: "未登录" }, { status: 401 });
	const id = paramId(event);
	if (!id || !getFile(user.id, id)) return json({ error: "附件不存在" }, { status: 404 });
	await deleteFile(user.id, id);
	recordActivity({ userId: user.id, username: user.username, action: "other", target: `file-delete:${id}` });
	return json({ ok: true });
}
