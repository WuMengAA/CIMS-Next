/**
 * 被控轴 · 截图回传（`POST /api/device/capture`）
 *
 * body: `{ uid, image_base64 }` —— 教室端把截好的 PNG 以 base64 回传。
 * 面板轮询取图走控制轴（`GET /api/console/control/captures`），与本端点对称。
 *
 * 三道校验都从旧实现原样搬来，缺一不可：
 *   1. **base64 严格性**：解码再编码必须还原原串 —— 防"垃圾字节碰巧可解码"被当成图收下；
 *   2. **PNG 魔数**：`0x89 'P' 'N' 'G'`，且长度 ≥64 字节 —— 防任意字节占位；
 *   3. **BODY_SIZE_LIMIT 单独提示**：报文超限时 `request.json()` 整体回落成 `{}`，
 *      症状是"uid 不能为空"，但真因是**整个报文被拒**（base64 会让体积膨胀约 4/3）。
 *      分开提示，免得排查被引到设备那一侧。
 *
 * 来源：旧 `POST /api/console/ext/captures`（设备密钥分支）。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { putDeviceCapture, addAudit } from "$lib/server/console-ext.js";
import { guardDevice, readDeviceBody, bodyLooksTruncated } from "$lib/server/guard-device.js";

export async function POST(event: RequestEvent) {
	const g = guardDevice(event);
	if ("error" in g) return g.error;

	const body = await readDeviceBody(event);
	const uid = String(body.uid ?? "").trim();
	if (!uid) {
		return json(
			{
				error: bodyLooksTruncated(body)
					? "请求体为空：多半是报文超过服务端 BODY_SIZE_LIMIT 上限、被整体拒绝（截图 base64 后会膨胀约 4/3，请检查图片体积）"
					: "uid 不能为空"
			},
			{ status: 400 }
		);
	}

	const b64 = String(body.image_base64 ?? "").trim();
	if (!b64) return json({ error: "缺少 image_base64" }, { status: 400 });

	let raw: Buffer;
	try {
		raw = Buffer.from(b64, "base64");
		if (raw.toString("base64").replace(/=+$/g, "") !== b64.replace(/=+$/g, "")) {
			throw new Error("bad base64");
		}
	} catch {
		return json({ error: "image_base64 不是合法 base64" }, { status: 400 });
	}

	if (raw.length < 64 || raw[0] !== 0x89 || raw[1] !== 0x50 || raw[2] !== 0x4e || raw[3] !== 0x47) {
		return json({ error: "回传内容不是有效 PNG（<64B 或魔数不符）" }, { status: 400 });
	}

	const meta = await putDeviceCapture(uid, raw);
	await addAudit({
		actor: `device:${uid}`,
		role: "device",
		action: "capture.report",
		target: uid,
		detail: `${raw.length} bytes → ${meta.path.split(/[\\/]/).pop()}`
	});
	return json({ ok: true, at: meta.at, bytes: raw.length });
}
