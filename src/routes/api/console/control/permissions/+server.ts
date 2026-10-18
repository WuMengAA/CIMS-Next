/**
 * 控制轴 · 权限与分级矩阵（`GET /api/console/control/permissions`）
 *
 * 「权限与分级」页的**唯一数据源**：等级轴 + 设备轴 + 管理分级轴 + 广播范围轴，
 * 以及**当前账号**的已解算快照（`me`）。
 *
 * ⚠️ **服务端算、前端只渲染。** 前端自行推导权限是最容易出现
 * "界面显示能点、服务端 403"的地方。传完整用户对象（含 `user_titles` 显式称号），
 * `me` 快照与 `userCan()` 门控**同源**。
 *
 * 来源：旧 `GET /api/console/ext/permissions`。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { permissionMatrix } from "$lib/permissions.js";
import { guardControl } from "$lib/server/guard-control.js";

export async function GET(event: RequestEvent) {
	const g = await guardControl(event);
	if ("error" in g) return g.error;
	return json(permissionMatrix((await g).user));
}
