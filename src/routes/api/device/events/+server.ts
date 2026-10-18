/**
 * 被控轴 · 执行回执上报（`POST /api/device/events`）
 *
 * 教室端「动作做完之后」的上报 —— **流水账**：这台机器发生过什么。
 * 与 `task-result` 的分工：那个是**回单**（老师刚点的那一下成没成）。
 *
 * ⚠️ **这里不做按来源 IP 的限流**（旧实现的原话，照搬）：
 * 站点跑在 cloudflared 隧道后时，服务端看到的源 IP **恒为 127.0.0.1**（回环转发），
 * 按来源封禁会把全校设备当成一个来源误封 60 秒。
 * 真正的闸门是**部署级共享密钥** + 下面 `extra` 的体积收敛。
 * 这条踩过，症状是"某一时刻全域掉线"，极难归因到这一行。
 *
 * 另一条：`extra` 的坏字段**只影响这条回执本身**，绝不影响设备 ——
 * 那个动作在机器上是**真的做了**，回执丢了只是少一行日志。
 *
 * 来源：旧 `POST /api/console/ext/events`（设备密钥分支）。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { addDeviceEvent } from "$lib/server/console-ext.js";
import { guardDevice, readDeviceBody } from "$lib/server/guard-device.js";

export async function POST(event: RequestEvent) {
	const g = guardDevice(event);
	if ("error" in g) return g.error;

	const body = await readDeviceBody(event);
	const uid = String(body.uid ?? "").trim();
	const ev = String(body.event ?? "").trim();
	if (!uid || !ev) return json({ error: "uid/event 不能为空" }, { status: 400 });

	const rawExtra =
		body.extra && typeof body.extra === "object" && !Array.isArray(body.extra)
			? (body.extra as Record<string, unknown>)
			: undefined;

	try {
		const rec = await addDeviceEvent({
			uid,
			event: ev,
			ok: body.ok !== false,
			detail: String(body.detail ?? ""),
			extra: rawExtra,
			at: String(body.at ?? "") || undefined
		});
		return json({ ok: true, id: rec.id }, { status: 201 });
	} catch (e) {
		// 事件名/uid 非法只在这里报错 —— 绝不让一条回执的坏字段影响设备本身。
		return json({ error: String((e as Error)?.message ?? e) }, { status: 400 });
	}
}
