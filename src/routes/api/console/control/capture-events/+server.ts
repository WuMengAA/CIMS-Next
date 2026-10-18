/**
 * 控制轴 · 新截图就绪事件（`GET /api/console/control/capture-events`）
 *
 * 操控端据此推送「XX 设备已回传截图」通知，**而不是逐台轮询 captures**。
 * 只返回「谁、什么时候」，图仍走 `./captures` 取。
 *
 * 权限：需要 `watch` 能力；事件列表按班级范围收敛。
 *
 * ⚠️ 收敛时对"设备班解析不到"的事件**选择给**（宁可多给一次通知）——
 * 与 `./captures` 取图时的"解析不到就不给"**刻意相反**：
 * 取图是**泄露内容**，宁严勿泄；通知只是**提示有心跳**，宁可多给。
 * 两处的松紧不同是有意的，别"统一"成一样。
 *
 * 来源：旧 `GET /api/console/ext/capture-events`。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { canDeviceAction } from "$lib/permissions.js";
import { classScopeOf, scopeCovers } from "$lib/server/class-scope.js";
import { resolveClassOfDevice } from "$lib/server/device-bindings.js";
import { listCaptureReadyEvents } from "$lib/server/console-ext.js";
import { guardControl } from "$lib/server/guard-control.js";

export async function GET(event: RequestEvent) {
	const g = await guardControl(event);
	if ("error" in g) return g.error;
	const u = g.user;

	if (!canDeviceAction(u.role, "watch")) {
		return json({ error: "无权限（需要监控能力）" }, { status: 403 });
	}

	const events = await listCaptureReadyEvents();
	const scope = await classScopeOf(u.role, u.id);
	if (scope === "*") return json({ events, reason: "ok" });

	const filtered: typeof events = [];
	for (const e of events) {
		const cid = await resolveClassOfDevice(e.uid);
		if (cid && scopeCovers(scope, cid)) filtered.push(e);
		else if (!cid) filtered.push(e); // 设备班解析不到：给（宁可多给一次通知）
	}
	return json({ events: filtered, reason: "ok" });
}
