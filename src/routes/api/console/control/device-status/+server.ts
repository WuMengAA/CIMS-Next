import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { userCan } from "$lib/permissions.js";
import { cloudDeviceStatus } from "$lib/server/broadcast.js";
import { listDeviceBindings } from "$lib/server/device-bindings.js";

/**
 * 设备列表 + 在线状态（2026-10-05 · devices/apps/logs/volume/remote 页的自有来源，取代 CIMS device-status）。
 *
 * GET /api/console/control/device-status
 *  → {
 *      devices: [ { client_id, host, class_id, class_name, online, reported, version, age_seconds } ],
 *      source: "local+cloud" | "local" | "none"
 *    }
 *    —— devices[] 形态与 CIMS device-status 兼容（各页 norm() 直接吃）；班级名/显示名来自
 *       device_bindings，在线状态来自云端（不在云端 = offline）。
 *
 * 权限：viewConsole（看状态是基础可见性，与 CIMS device-status 同口径）。
 */
export async function GET(event: RequestEvent) {
	const cookieToken = event.cookies.get("admin_token");
	let u = cookieToken ? await verifyToken(cookieToken) : null;
	if (!u) {
		const auth = event.request.headers.get("authorization") ?? "";
		if (auth.toLowerCase().startsWith("bearer ")) u = await verifyToken(auth.slice(7).trim());
	}
	if (!u) return json({ error: "请先登录" }, { status: 401 });
	if (!userCan(u, "viewConsole")) return json({ error: "无权限" }, { status: 403 });

	const onlineMap = await cloudDeviceStatus();
	const bindings = await listDeviceBindings();

	const devices = bindings.map((b) => {
		const st = onlineMap[b.uid] || onlineMap[b.uid.toLowerCase()] || { online: false, version: "", lastSeenAgoSec: 0 };
		return {
			client_id: b.uid,
			host: b.display_name || "",
			class_id: b.class_id,
			class_name: b.class_name,
			online: !!st.online,
			reported: true,
			version: st.version || "",
			age_seconds: st.online ? st.lastSeenAgoSec : null
		};
	});

	const source = devices.length ? (Object.keys(onlineMap).length ? "local+cloud" : "local") : "none";
	return json({ devices, source, fresh_seconds: 30 });
}