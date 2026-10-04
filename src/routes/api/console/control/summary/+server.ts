/**
 * 控制轴 · 面板汇总计数（`GET /api/console/control/summary`）
 *
 * 通知数 / 交流消息数 / 审计条数 / 最近审计时间。
 *
 * 来源：旧 `GET /api/console/ext/summary`。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { consoleSummary } from "$lib/server/console-ext.js";
import { guardControl } from "$lib/server/guard-control.js";

export function GET(event: RequestEvent) {
	const g = guardControl(event);
	if ("error" in g) return g.error;
	return json(consoleSummary());
}
