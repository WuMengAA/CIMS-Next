/**
 * 控制轴 · 查 VNC 会话（`GET /api/console/control/sessions?uid=&host=`）
 *
 * 面板/控制端轮询取教室端回报的远控会话地址，再嵌进窗口。
 *
 * ⚠️ **双 key**（#T07.7 步骤 5 脱节修复，别删）：
 * 面板下发指令用的是 CIMS 的 `client_id`（`lab-pc-001`），
 * 而教室端代理回报时用的是自己的 `device_uid`（主机名 `n7-20091211`）——
 * **两者是不同的串**。只按 client_id 查会永远 `no_session_reported`，
 * 即使代理早就报过。所以：先按 uid 查，miss 再按 host 查。
 * 查询 key 本身已小写归一化（`console-ext.ts` 的 `sKey`），host 传大写也能命中。
 *
 * 返回里 `reason` 明确区分「没人报过」与「报过但已过期」——
 * 前者要查代理，后者只要重发一次指令。
 *
 * 来源：旧 `GET /api/console/ext/vnc-session`（用户会话分支）。
 * 对称的被控轴是 `POST/DELETE /api/device/session`（设备上报/注销）。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { getDeviceSession } from "$lib/server/console-ext.js";
import { guardControl } from "$lib/server/guard-control.js";

export function GET(event: RequestEvent) {
	const g = guardControl(event);
	if ("error" in g) return g.error;

	const uid = String(event.url.searchParams.get("uid") ?? "").trim();
	const host = String(event.url.searchParams.get("host") ?? "").trim();
	if (!uid && !host) return json({ session: null, reason: "missing_uid" });

	const s = getDeviceSession("vnc", uid) || (host ? getDeviceSession("vnc", host) : null);
	return json({ session: s, reason: s ? "ok" : "no_session_reported" });
}
