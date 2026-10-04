/**
 * 控制轴 · 审计链自检（`GET /api/console/control/audit/verify`）
 *
 * 走一遍哈希链，回报「从第几行起可校验 / 第一处断在哪 / 为什么」。
 *
 * ⚠️ **不给「可信 / 不可信」的二值结论** —— 历史裁剪与旧库迁移都会**合法地**
 * 让链不完整，二值化会把「正常裁剪」和「有人改库」混为一谈。
 *
 * 来源：旧 `GET /api/console/ext/audit/verify`。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { verifyAudit, auditPolicy } from "$lib/server/console-ext.js";
import { guardControl } from "$lib/server/guard-control.js";

export function GET(event: RequestEvent) {
	const g = guardControl(event);
	if ("error" in g) return g.error;
	return json({ verify: verifyAudit(), policy: auditPolicy() });
}
