/**
 * 被控轴 · 通知 catch-up（`GET /api/device/notices?pending_for=<uid>&since=<游标>&limit=20`）
 *
 * 教室端重启后拉取"这台设备还没处理过的"类型化通知（island / popup / fullscreen）。
 *
 * `since` = 已处理到的最大 `notice_id`（游标）。客户端把它存下来下次带上，
 * 一次拉不完就分页，且**同一条不会因为仍是 pending 而被反复弹**。
 * 不传 `since` 仍按老行为取前 N 条 —— 旧客户端不必改造就能继续跑。
 *
 * 来源：旧 `GET /api/console/ext/notices?pending_for=...`（设备密钥分支）。
 * 注意与**控制轴**的区别：控制轴读同一份通知的**历史/进度**，
 * 是 `GET /api/console/control/notices`；两条轴名字像、语义完全不同。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { listPendingTypedNoticesPage } from "$lib/server/console-ext.js";
import { guardDevice } from "$lib/server/guard-device.js";

export async function GET(event: RequestEvent) {
	const g = guardDevice(event);
	if ("error" in g) return g.error;

	const q = event.url.searchParams;
	const uid = String(await q.get("pending_for") ?? "").trim();
	if (!uid) return json({ error: "缺少 pending_for（设备 uid）" }, { status: 400 });

	const sinceRaw = String(await q.get("since") ?? "").trim();
	const page = await listPendingTypedNoticesPage(
		uid,
		Number(sinceRaw) || 0,
		Number(q.get("limit") ?? 20) || 20
	);
	return json({ notices: (await page).notices, cursor: (await page).cursor });
}
