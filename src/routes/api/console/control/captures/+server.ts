/**
 * 控制轴 · 取设备截图（`GET /api/console/control/captures?uid=&host=&history=1&frame=&limit=`）
 *
 * 三种用法（同一端点，靠 query 分流）：
 *   1. **默认**：取最新一张实时截图（面板点「截图」后轮询这里）；
 *   2. `history=1`：取历史时间线（监控回放）；
 *   3. `frame=<id>`：按帧 id 取单张。
 *
 * ⚠️ 三条判据，都从旧实现原样搬来：
 *   · **双 key**（uid → host 回退）：面板用 CIMS `client_id`、教室端用 `device_uid`，
 *     是不同的串；只按一个查会永远 `no_capture_reported`，即使代理早就报过。
 *   · **班级范围收敛**：回放与实时取图都要过 `scopeCovers`。
 *     设备班**解析不到 = 确定不了归属 → 不给**（宁严勿滥）。
 *   · **图片以 base64 内嵌返回**，不另开图片二进制端点——少一个可被滥用的静态出口。
 *
 * 来源：旧 `GET /api/console/ext/captures`（用户会话分支）。
 * 对称的被控轴是 `POST /api/device/capture`（设备回传 PNG）。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { canDeviceAction } from "$lib/permissions.js";
import { classScopeOf, scopeCovers } from "$lib/server/class-scope.js";
import { resolveClassOfDevice } from "$lib/server/device-bindings.js";
import {
	getDeviceCapture,
	getDeviceCaptureById,
	listDeviceCaptures
} from "$lib/server/console-ext.js";
import { guardControl } from "$lib/server/guard-control.js";

export async function GET(event: RequestEvent) {
	const g = await guardControl(event);
	if ("error" in g) return g.error;
	const u = g.user;

	const q = event.url.searchParams;
	const uid = String(await q.get("uid") ?? "").trim();
	const host = String(await q.get("host") ?? "").trim();
	if (!uid && !host) return json({ capture: null, reason: "missing_uid" });

	const target = uid || host;
	const scope = await classScopeOf(u.role, u.id);

	// ── v2：监控回放（历史时间线 + 按帧取图）─────────────────────────────
	// 需要 watch 或 playback 动作；目标设备的班必须在调用者班级范围内。
	if (await q.get("history") === "1" || await q.get("frame")) {
		if (!canDeviceAction(u.role, "watch") && !canDeviceAction(u.role, "playback")) {
			return json({ error: "无权限（需要监控/回放能力）" }, { status: 403 });
		}
		if (scope !== "*") {
			const cid = await resolveClassOfDevice(target);
			if (!cid || !scopeCovers(scope, cid)) {
				return json({ error: "目标设备不在你的班级范围内" }, { status: 403 });
			}
		}
		const frameId = Number(await q.get("frame") ?? 0);
		if (frameId > 0) {
			const f = await getDeviceCaptureById(frameId);
			if (!f) return json({ capture: null, reason: "frame_gone" });
			return json({
				capture: { at: f.meta.at, bytes: f.meta.bytes, image_base64: f.png.toString("base64") },
				reason: "ok"
			});
		}
		const limit = Number(await q.get("limit") ?? 60) || 60;
		return json({ history: await listDeviceCaptures(target, limit), reason: "ok" });
	}

	// 实时最新一张：同样按班级范围收敛（班主任看本班、站长看全校）。
	if (canDeviceAction(u.role, "watch") && scope !== "*") {
		const cid = await resolveClassOfDevice(target);
		if (cid && !scopeCovers(scope, cid)) {
			return json({ capture: null, reason: "out_of_scope" });
		}
	}
	const c = getDeviceCapture(uid) || (host ? getDeviceCapture(host) : null);
	if (!c) return json({ capture: null, reason: "no_capture_reported" });
	return json({
		capture: {
			at: c.meta.at,
			bytes: c.meta.bytes,
			image_base64: c.png.toString("base64")
		},
		reason: "ok"
	});
}
