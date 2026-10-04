/**
 * 集控 · 设备↔班级绑定（`GET / POST /api/console/device-bindings`）
 *
 * GET  —— 返回**本地优先**的"哪台机器在哪个班"。形态与 devices 页原来吃的
 *          `/api/console/cims/class/device-map` 一致（`{ devices, classes }`），
 *          并额外带 `bindings`（完整登记行）与 `source`（这批数据来自本地还是 CIMS）。
 *          本地没登记到的设备才回退问 CIMS；CIMS 不可达时纯本地结果照常返回
 *          —— 这是"机器归班不再依赖 CIMS 在线"的落点。
 * POST —— 管理员给机器起个好认的显示名（`{ uid, displayName }`）。需要 `manage` 档。
 *
 * 这是新轴端点（与旧 `/api/console/ext/[...path]` 双轨并存），故用 guardControl 统一守卫。
 */
import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { guardControl, readControlBody } from "$lib/server/guard-control.js";
import {
	listDeviceBindings,
	resolveDeviceClassMap,
	setDeviceDisplayName
} from "$lib/server/device-bindings.js";

export async function GET(event: RequestEvent) {
	const g = guardControl(event);
	if ("error" in g) return g.error;

	const map = await resolveDeviceClassMap();
	// devices 页只认 devices/classes 两个键；bindings/source 是额外信息，不影响它。
	const devices: Record<string, string> = {};
	for (const d of map.devices) if (d.class_id) devices[d.uid] = d.class_id;
	return json({
		devices,
		classes: map.classes,
		bindings: listDeviceBindings(),
		source: map.source
	});
}

export async function POST(event: RequestEvent) {
	const g = guardControl(event, "manage");
	if ("error" in g) return g.error;

	const body = await readControlBody(event);
	const uid = String(body.uid ?? "").trim();
	if (!uid) return json({ error: "缺少 uid" }, { status: 400 });
	const displayName = String(body.displayName ?? "").trim();
	const ok = setDeviceDisplayName(uid, displayName);
	if (!ok) return json({ error: "该设备尚未登记归班，无法命名" }, { status: 404 });
	return json({ ok: true, uid, displayName });
}
