/**
 * 控制轴 · 查媒体直连会话（`GET /api/console/control/media-sessions?uid=&host=`）
 *
 * 快照 / 录像下载用的直连地址。与 `./sessions`（VNC）**结构完全对称**，只差 proto。
 *
 * 与 `./sessions` 一样必须**双 key**（uid → host 回退），原因见那边的注释：
 * 面板用 CIMS `client_id`、教室端用 `device_uid`，是不同的串。
 *
 * 来源：旧 `GET /api/console/ext/media-session`（用户会话分支）。
 * 对称的被控轴是 `POST/DELETE /api/device/media-session`。
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

	const s = getDeviceSession("media", uid) || (host ? getDeviceSession("media", host) : null);
	return json({ session: s, reason: s ? "ok" : "no_session_reported" });
}
