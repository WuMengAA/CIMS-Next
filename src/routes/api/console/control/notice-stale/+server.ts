/**
 * 控制轴 · 消息错过提醒（`GET /api/console/control/notice-stale?minutes=10&limit=100`）
 *
 * 发出去 N 分钟还是 pending 的投递 → 大概率没收到。
 * 面板据此列出「这些机器可能没收到」，而不是让老师对着一片沉默猜。
 *
 * ⚠️ 这是**提示**不是**判死**：pending 只说明没回执，超时/无回执**绝不当失败**。
 * 文案上也必须保持这个口径，别在这里改写设备状态。
 *
 * 来源：旧 `GET /api/console/ext/notice-stale`。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { listStaleDeliveries } from "$lib/server/console-ext.js";
import { guardControl } from "$lib/server/guard-control.js";

export async function GET(event: RequestEvent) {
	const g = guardControl(event);
	if ("error" in g) return g.error;

	const q = event.url.searchParams;
	return json({
		stale: listStaleDeliveries(
			Number(await q.get("minutes") ?? 10) || 10,
			Number(await q.get("limit") ?? 100) || 100
		)
	});
}
