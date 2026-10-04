/**
 * 被控轴 · 拉取监控参数（`GET /api/device/monitor-config`）
 *
 * 教室端读截图质量 / 最大宽度 / 采样间隔 / 录像保留等配置。
 * 面板改配置走控制轴（`PUT /api/console/control/monitor-config`），
 * **同一份数据、两个方向的两条轴** —— 这正是两轴分离要达成的形态：
 * 读配置是设备的事、写配置是人的事，谁也不该借对方的路。
 *
 * 来源：旧 `GET /api/console/ext/monitor-config`（设备密钥分支）。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { getMonitorConfig } from "$lib/server/console-ext.js";
import { guardDevice } from "$lib/server/guard-device.js";

export function GET(event: RequestEvent) {
	const g = guardDevice(event);
	if ("error" in g) return g.error;
	return json({ config: getMonitorConfig() });
}
