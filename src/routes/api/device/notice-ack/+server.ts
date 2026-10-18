/**
 * 被控轴 · 通知回执（`POST /api/device/notice-ack`）
 *
 * body: `{ notice_id, uid, state: received|read|replied|rejected|dismissed, action_result? }`
 *
 * 状态语义：
 *   · `received`  —— 收到
 *   · `read`      —— 已读
 *   · `replied`   —— 已回复（`action_result` 为预设短语原文）
 *   · `rejected`  —— 用户点了取消 / 不在场
 *   · `dismissed` —— 岛通知轮播结束，不打扰
 *
 * ⚠️ **防伪面**（与 `notice-reply` 同款，两条必须一起看）：
 * uid 由设备**自称**（密钥是部署级共享的），所以这里再收敛一层：
 * `markNoticeDelivery` 只更新**发给这个 uid 且未到终态**的行。
 * 虚报 uid 顶多把同名行提前标已读，**拿不到任何内容**。
 *
 * 与 `notice-reply` 的分工：ack 说的是**状态**（收到了 / 用了哪个预设），
 * reply 说的是**内容**（她到底回了什么话）。只做 ack 的话，操控端永远看不到
 * 老师在弹窗上写的那句话，老师会认定"回复功能坏了"。
 *
 * 来源：旧 `POST /api/console/ext/notice-ack`（设备密钥分支）。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { markNoticeDelivery, addAudit } from "$lib/server/console-ext.js";
import { guardDevice, readDeviceBody } from "$lib/server/guard-device.js";

const STATES = ["read", "replied", "rejected", "dismissed", "received"];

export async function POST(event: RequestEvent) {
	const g = guardDevice(event);
	if ("error" in g) return g.error;

	const body = await readDeviceBody(event);
	const nid = Number(body.notice_id ?? 0);
	const uid = String(body.uid ?? "").trim();
	if (!nid || !uid) return json({ error: "notice_id/uid 不能为空" }, { status: 400 });

	const st = STATES.includes(String(body.state)) ? String(body.state) : "read";
	const ok = await markNoticeDelivery(
		nid,
		uid,
		st,
		st === "replied" ? String(body.action_result ?? "") : ""
	);

	await addAudit({
		actor: `device:${uid}`,
		role: "device",
		action: "notice.ack",
		target: String(nid),
		detail: `${st}${st === "replied" ? "：" + String(body.action_result ?? "").slice(0, 120) : ""}`
	});
	return json({ ok, state: st });
}
