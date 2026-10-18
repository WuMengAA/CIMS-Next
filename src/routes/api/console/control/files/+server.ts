/**
 * 控制轴 · 上传文件（`POST /api/console/control/files`，multipart）
 *
 * 发送方（老师/班主任/电教委员/站长）带**用户会话**上传文件本体；
 * 之后调 `./file-push` 把它推给目标班级/设备。
 *
 * 这里只校验「能力」（`file` 动作），**「班级范围」在 file-push 解析出目标设备后逐台判定** ——
 * 因为上传时还不知道要推给谁。
 *
 * ⚠️ 必须走 `formData()` 而**不能**走 `readControlBody()`（JSON 解析吃不了 multipart）。
 * 旧实现里这条分支也被**刻意放在 `readBody` 之前**，就是这个原因。
 *
 * 来源：旧 `POST /api/console/ext/files`（无设备密钥分支）。
 * 对称的被控轴是 `GET /api/device/files/[id]`（设备下载）。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { saveUpload, MAX_FILE_BYTES } from "$lib/server/file-transfer.js";
// ⚠️ 用 `guardControlDeviceAction`（细档 `file`），**不是** `guardControl(event,"file")` ——
// `"file"` 是 DeviceAction，不是 Action、也不是 DeviceTier（"file" 不在粗档表里）。
// 传错形态 svelte-check 会当场拦下；这也是"三轴"必须显式区分的原因。
import { guardControlDeviceAction } from "$lib/server/guard-control.js";

export async function POST(event: RequestEvent) {
	const g = await guardControlDeviceAction(event, "file");
	if ("error" in g) return g.error;
	const up = g.user;

	try {
		const form = await event.request.formData();
		const f = form.get("file");
		if (!(f instanceof File)) return json({ error: "缺少 file 字段（multipart）" }, { status: 400 });
		if (f.size > MAX_FILE_BYTES) {
			return json(
				{ error: `文件超过大小上限（${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB）` },
				{ status: 413 }
			);
		}
		const kind = String(form.get("kind") ?? "file") === "voice" ? "voice" : "file";
		const buf = Buffer.from(await f.arrayBuffer());
		const obj = await saveUpload(f.name || "未命名文件", buf, kind, up.displayName || up.username);
		return json({ ok: true, file: obj }, { status: 201 });
	} catch (e) {
		return json({ error: String((e as Error)?.message ?? e) }, { status: 400 });
	}
}
