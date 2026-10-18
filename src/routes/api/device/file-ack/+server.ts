/**
 * 被控轴 · 文件送达回执（`POST /api/device/file-ack`）
 *
 * body: `{ file_id, uid, state: "acked" | "failed", detail? }`
 *
 * 「文件传输后没有消息提示」的**发送方半边**靠它点亮 ——
 * 老师能在传文件页看到每台设备的真实状态，而不是"发送成功 = 万事大吉"。
 *
 * ⚠️ 口径（全项目一致，别在这里另立一套）：
 *   · 只有 `acked` / `failed` 是**设备给的结论**；
 *   · `pending` = 还没有回执，**不等于失败**；
 *   · 面板侧 **`done` 才是绿**，超时/无回执**绝不当失败**。
 *
 * 来源：旧 `POST /api/console/ext/file-ack`（设备密钥分支）。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { addAudit } from "$lib/server/console-ext.js";
// ⚠️ `updateDelivery` 属**文件传输**模块（`file-transfer.js`），不在 `console-ext.js`。
// 这两个模块都又大又像，导入时容易放错 —— 放错的表现是类型错误"has no exported member"，
// 好在 svelte-check 会当场拦下（若漏过去，运行时就是 undefined 调用 → 500）。
import { updateDelivery } from "$lib/server/file-transfer.js";
import { guardDevice, readDeviceBody } from "$lib/server/guard-device.js";

export async function POST(event: RequestEvent) {
	const g = guardDevice(event);
	if ("error" in g) return g.error;

	const body = await readDeviceBody(event);
	const fid = String(body.file_id ?? "").trim();
	const uid = String(body.uid ?? "").trim();
	if (!fid || !uid) return json({ error: "file_id/uid 不能为空" }, { status: 400 });

	// 只接受两个终态；其它一律视为 pending（不是失败）。
	const state = body.state === "acked" ? "acked" : body.state === "failed" ? "failed" : "pending";

	const okUp = await updateDelivery(fid, uid, state, String(body.detail ?? ""));
	await addAudit({
		actor: `device:${uid}`,
		role: "device",
		action: "file.ack",
		target: fid,
		detail: `${state}${body.detail ? "：" + String(body.detail).slice(0, 120) : ""}`
	});
	return json({ ok: okUp, state });
}
