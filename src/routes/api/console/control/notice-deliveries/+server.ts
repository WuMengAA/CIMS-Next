/**
 * 控制轴 · 通知逐台回执明细（`GET /api/console/control/notice-deliveries?notice=<id>`）
 *
 * 面板的「谁看了、谁没看」明细。行里带 `reply` 字段：老师在弹窗上打的那句话
 * **原样出网**，操控端才叫「收到回应」。
 *
 * 权限：viewConsole 即可，与"看历史"同一档 —— 回执含设备 uid 属内部信息，不对外。
 *
 * 来源：旧 `GET /api/console/ext/notice-deliveries`。
 * 对称的被控轴是 `POST /api/device/notice-ack` / `notice-reply`（设备写回执）。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { getNoticeById, listNoticeDeliveries } from "$lib/server/console-ext.js";
import { guardControl } from "$lib/server/guard-control.js";

export function GET(event: RequestEvent) {
	const g = guardControl(event);
	if ("error" in g) return g.error;

	const nid = Number(event.url.searchParams.get("notice") ?? 0);
	if (!nid) return json({ error: "缺少 notice 参数" }, { status: 400 });

	const n = getNoticeById(nid);
	if (!n) return json({ error: "通知不存在" }, { status: 404 });
	return json({ notice: n, deliveries: listNoticeDeliveries(nid) });
}
