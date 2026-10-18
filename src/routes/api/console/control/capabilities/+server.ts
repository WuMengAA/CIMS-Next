/**
 * 控制轴 · 我的功能开关（`GET /api/console/control/capabilities`）
 *
 * 「按身份与权限决定开启或关闭某些功能」的**裁决出口**。
 *
 * ⚠️ 只返回**结论**（每个功能 true/false），**不返回规则**：
 * 规则留在服务端，前端改代码开不出任何功能。
 * 一并返回 `defaults` / `overridden`，面板才能标出"这条是单独给你开的"——
 * 否则老师会以为全校老师都能发全屏通知。
 *
 * 来源：旧 `GET /api/console/ext/capabilities`。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { resolveUserFeatures } from "$lib/server/console-ext.js";
import { guardControl } from "$lib/server/guard-control.js";

export async function GET(event: RequestEvent) {
	const g = await guardControl(event);
	if ("error" in g) return g.error;

	const res = await resolveUserFeatures(String((await g).user.id), (await g).user.role);
	return json({
		role: (await g).user.role,
		features: (await res).features,
		defaults: (await res).defaults,
		overridden: (await res).overridden
	});
}
