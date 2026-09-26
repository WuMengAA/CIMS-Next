/**
 * POST /api/account/avatar —— 上传头像。
 *
 * 与「在设置里填一个图片 URL」的区别：这里真正处理文件（按 avif/webp 压缩、
 * 按 maxEdge 缩放、可选右下角水印），存进同一个 R2 桶的 avatar/ 前缀下，
 * 把返回的绝对 URL 写进 users.avatar。
 *
 * 老写法（手填 URL）仍然可用——它跟上传是并存的两条路，只是上传更省事也更省空间。
 */
import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { updateProfile } from "$lib/server/auth.js";
import { sessionUser } from "$lib/server/session.js";
import { recordActivity } from "$lib/server/activity.js";
import { saveUpload, MAX_AVATAR_BYTES, QuotaExceededError } from "$lib/server/attachment-library.js";
import { r2Configured, StorageNotConfiguredError } from "$lib/server/storage/r2.js";

const ALLOWED = /^image\/(jpeg|png|webp|avif|gif)$/;

export async function POST(event: RequestEvent) {
	const user = sessionUser(event);
	if (!user) return json({ error: "未登录" }, { status: 401 });
	let form: FormData;
	try {
		form = await event.request.formData();
	} catch {
		return json({ error: "不是有效的 multipart 上传" }, { status: 400 });
	}
	const file = form.get("file");
	if (!file || typeof file === "string") return json({ error: "缺少文件" }, { status: 400 });
	const blob = file as File;
	if (!blob.size) return json({ error: "空文件" }, { status: 400 });
	if (blob.size > MAX_AVATAR_BYTES) {
		return json({ error: `头像不能超过 ${Math.round(MAX_AVATAR_BYTES / 1024 / 1024)} MB` }, { status: 413 });
	}
	const isImage = ALLOWED.test(blob.type) || /\.(jpe?g|png|webp|avif|gif)$/i.test(blob.name);
	if (!isImage) return json({ error: "头像必须是图片（JPEG / PNG / WebP / AVIF / GIF）" }, { status: 400 });

	// 头像的画质参数刻意比附件库更保守：小图压到 avif q55 会发糊，头像要能看清脸。
	const formatRaw = String(form.get("format") ?? "webp");
	const format = (["webp", "avif", "original"].includes(formatRaw) ? formatRaw : "webp") as "webp" | "avif" | "original";

	try {
		const saved = await saveUpload({
			userId: user.id,
			filename: blob.name || "avatar" + (format === "avif" ? ".avif" : ".webp"),
			data: new Uint8Array(await blob.arrayBuffer()),
			mime: blob.type || "image/png",
			format,
			watermark: form.get("watermark") !== "off",
			keepOriginal: false,
			purpose: "avatar",
			maxEdge: 1024
		});

		const r = updateProfile(user.username, { avatar: saved.file.url });
		if (!r.ok) return json({ error: r.error }, { status: 400 });

		recordActivity({
			userId: user.id,
			username: user.username,
			action: "profile_update",
			target: user.username,
			detail: "更换头像"
		});

		return json({ ok: true, avatar: saved.file.url, file: saved.file });
	} catch (e) {
		if (e instanceof QuotaExceededError) return json({ error: e.message }, { status: 413 });
		if (e instanceof StorageNotConfiguredError) return json({ error: e.message }, { status: 503 });
		if (e instanceof Error && /无法解析这张图片/.test(e.message)) return json({ error: e.message }, { status: 400 });
		console.error("[avatar] upload failed", e);
		return json({ error: "头像上传失败：" + (e instanceof Error ? e.message : String(e)) }, { status: 500 });
	}
}
