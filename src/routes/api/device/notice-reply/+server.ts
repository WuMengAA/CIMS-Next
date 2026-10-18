/**
 * 被控轴 · 自由回复回传（`POST /api/device/notice-reply`）
 *
 * body: `{ notice_id, uid, text }` —— 老师在弹窗里**打了字**，或点了预设之外的回复。
 *
 * 与 `notice-ack` 的区别：ack 只说"收到了 / 已读 / 用了哪个预设"（**状态**），
 * reply 说的是"她到底回了什么话"（**内容**）。
 *
 * ⚠️ 防伪面同 notice-ack：uid 由设备自称，`markNoticeReply` 只更新
 * "发给这台设备"的行，虚报 uid 拿不到别台机器的回复内容。
 *
 * ⚠️ 命中不了要**给原因**（404 + reason），不能回 ok ——
 * "回 ok 但什么都没发生"正是这类功能最难查的形态。
 *
 * CIMS 聚合：落库成功后再 fire-and-forget 同步到 CIMS `notice_replies`，
 * 让操控端在 CIMS 回复收件箱也能看到桌面端（老师电脑）的回复。
 * **CIMS 不可达不影响本站已落库的回复** —— 所以用 `void` 不 await。
 *
 * 来源：旧 `POST /api/console/ext/notice-reply`（设备密钥分支）。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { markNoticeReply, addAudit } from "$lib/server/console-ext.js";
import { syncReplyToCims } from "$lib/server/cims-reply-sync.js";
import { guardDevice, readDeviceBody } from "$lib/server/guard-device.js";

export async function POST(event: RequestEvent) {
	const g = guardDevice(event);
	if ("error" in g) return g.error;

	const body = await readDeviceBody(event);
	const nid = Number(body.notice_id ?? 0);
	const uid = String(body.uid ?? "").trim();
	const text = String(body.text ?? body.body ?? "").trim();

	if (!nid || !uid) return json({ error: "notice_id/uid 不能为空" }, { status: 400 });
	if (!text) return json({ error: "回复内容不能为空" }, { status: 400 });

	const ok = await markNoticeReply(nid, uid, text);
	if (!ok) {
		return json(
			{ ok: false, reason: "这条通知不是发往该设备的（或已不存在），回复未记录" },
			{ status: 404 }
		);
	}

	await addAudit({
		actor: `device:${uid}`,
		role: "device",
		action: "notice.reply",
		target: String(nid),
		detail: text.slice(0, 120)
	});

	void await syncReplyToCims(uid, nid, text)
		.then((synced) => {
			if (!synced) console.warn(`[device/notice-reply] CIMS 回复同步失败 uid=${uid} nid=${nid}`);
		})
		.catch((e) => console.warn(`[device/notice-reply] CIMS 回复同步异常: ${e}`));

	return json({ ok: true, notice_id: nid, state: "replied" }, { status: 201 });
}
