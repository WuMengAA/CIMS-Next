/**
 * 控制轴 · 执行回执流水（`GET /api/console/control/events?uid=&hours=&limit=`）
 *
 * 面板「执行回执」页。`?uid=` 省略 = 全校总览（限 300 条，够看最近几天）。
 *
 * 权限沿用 viewConsole：回执只含"设备把事情做成什么样"，不含教师身份等敏感信息。
 *
 * 来源：旧 `GET /api/console/ext/events`（用户会话分支）。
 * 对称的被控轴是 `POST /api/device/events`（设备写流水账）。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { listDeviceEvents, deviceEventStats } from "$lib/server/console-ext.js";
import { guardControl } from "$lib/server/guard-control.js";

export function GET(event: RequestEvent) {
	const g = guardControl(event);
	if ("error" in g) return g.error;

	const q = event.url.searchParams;
	const uid = String(q.get("uid") ?? "").trim();
	const hours = Number(q.get("hours"));
	const stats = uid
		? deviceEventStats(uid, Number.isFinite(hours) && hours > 0 ? hours : 24)
		: null;

	return json({
		events: listDeviceEvents(uid || undefined, Number(q.get("limit") ?? 100) || 100),
		stats
	});
}
