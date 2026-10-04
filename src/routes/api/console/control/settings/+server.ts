/**
 * 控制轴 · 面板配置（`/api/console/control/settings`）
 *
 *   GET  — 读取面板持久化配置（任何能进面板的人都能读：只读不敏感，且前端要渲染当前策略）
 *   POST — PATCH 语义写入
 *
 * 权限：POST 需设备管理档（这些值**决定教室端行为** —— 是否走 P2P、压缩目标、录像保留天数）。
 *
 * ⚠️ **为什么必须存在服务端而不是 localStorage**（旧实现的原话，值得留）：
 * 这些值决定教室端行为，**必须全校一致**；localStorage 是"每台电脑各存一份"——
 * 运维在 A 机改了，B 机登录面板看到的还是旧值，两边下发的策略不一致，排查时会怀疑人生。
 *
 * ⚠️ **白名单写入**：除 `CONSOLE_SETTINGS_KEYS` 外一律忽略。
 * 这个 KV 是开放对象，不设白名单的话将来任何字段都能被写进来，
 * 等于给了一个"无害但无界"的写入面。
 *
 * 来源：旧 `GET/POST /api/console/ext/settings`。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import {
	getConsoleSettings,
	saveConsoleSettings,
	CONSOLE_SETTINGS_KEYS,
	addAudit
} from "$lib/server/console-ext.js";
import { guardControl, readControlBody } from "$lib/server/guard-control.js";

export function GET(event: RequestEvent) {
	const g = guardControl(event);
	if ("error" in g) return g.error;
	return json({ settings: getConsoleSettings() });
}

export async function POST(event: RequestEvent) {
	const g = guardControl(event, "manage");
	if ("error" in g) return g.error;
	const actor = g.user.displayName || g.user.username;

	const body = await readControlBody(event);
	const patch: Record<string, unknown> = {};
	for (const k of CONSOLE_SETTINGS_KEYS) if (k in body) patch[k] = body[k];

	const saved = saveConsoleSettings(patch);
	addAudit({
		actor,
		role: g.user.role,
		action: "settings.update",
		target: "console",
		detail: `更新面板配置：${Object.keys(patch).join("、") || "（无变化）"}`.slice(0, 200)
	});
	return json({ ok: true, settings: saved });
}
