/** POST /api/library/[id]/compress —— 一键压缩（avif/webp），可选保留原图可随时还原。 */
import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { sessionUser } from "$lib/server/session.js";
import { recordActivity } from "$lib/server/activity.js";
import { getFile, recompressFile, restoreOriginal } from "$lib/server/attachment-library.js";

export async function POST(event: RequestEvent) {
	const user = await sessionUser(event);
	if (!user) return json({ error: "未登录" }, { status: 401 });
	const id = event.params.id ?? "";
	const f = id ? await getFile(user.id, id) : null;
	if (!f) return json({ error: "附件不存在" }, { status: 404 });
	if (!f.isImage) return json({ error: "非图片无法压缩" }, { status: 400 });

	const body = (await event.request.json().catch(() => ({}))) as Record<string, unknown>;
	const mode = String(body.mode ?? "compress");
	const format = (["avif", "webp"].includes(String(body.format)) ? String(body.format) : "avif") as "avif" | "webp";

	try {
		if (mode === "restore") {
			const r = await restoreOriginal(user.id, id);
			recordActivity({ userId: user.id, username: user.username, action: "other", target: `restore:${f.filename}` });
			return json({ ok: true, mode: "restore", ...r, file: await getFile(user.id, id) });
		}
		const r = await recompressFile(user.id, id, format, {
			watermark: body.watermark === undefined ? true : !!body.watermark,
			keepOriginal: body.keepOriginal === true
		});
		recordActivity({
			userId: user.id,
			username: user.username,
			action: "other",
			target: `compress:${f.filename}`,
			detail: `${r.appliedFormat} 省下 ${r.savedBytes} B`
		});
		return json({ ok: true, mode: "compress", ...r, file: await getFile(user.id, id) });
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 });
	}
}
