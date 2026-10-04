/**
 * 控制轴 · 会话登记表（`GET /api/console/control/session-registry`）
 *
 * 诊断页用：一眼看到"代理到底有没有报过"，而不是只有 `session:null` 一个空字。
 *
 * ⚠️ 命名要说清，别和同目录的 `./sessions` 搞混：
 *   · `sessions`         = 按 uid/host **查某一台**的 VNC 会话（面板轮询用，双 key）
 *   · `session-registry` = **列出全部**未过期会话（诊断用）
 * 旧实现里这两个分别叫 `vnc-session` 和 `sessions` —— 名字近义、
 * 语义一个是"查一个"一个是"列全部"，很容易看错。拆开并改名就是为了消除这个歧义。
 *
 * 来源：旧 `GET /api/console/ext/sessions`。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { listDeviceSessions } from "$lib/server/console-ext.js";
import { guardControl } from "$lib/server/guard-control.js";

export function GET(event: RequestEvent) {
	const g = guardControl(event);
	if ("error" in g) return g.error;
	return json({ sessions: listDeviceSessions() });
}
