import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { userCan } from "$lib/permissions.js";
import { assignDeviceToClass, unassignDeviceFromClass } from "$lib/server/device-bindings.js";
import { addAudit } from "$lib/server/console-ext.js";

/**
 * 设备归班写操作（2026-10-04 · 彻底去 CIMS：/class/device/assign|unassign 的自有替代）。
 *
 *  POST   /api/class/device  归班 {uid, classId}  → 200 {ok, uid, classId}
 *  DELETE /api/class/device?uid=  移出班级        → 200 {ok, uid}
 *
 * 权限：manage。写 device_bindings 表（本地真源），CIMS 不再参与。
 */

async function authUser(event: RequestEvent) {
	const cookieToken = event.cookies.get("admin_token");
	let u = cookieToken ? await verifyToken(cookieToken) : null;
	if (!u) {
		const auth = event.request.headers.get("authorization") ?? "";
		if (auth.toLowerCase().startsWith("bearer ")) u = await verifyToken(auth.slice(7).trim());
	}
	return u;
}

export async function POST(event: RequestEvent) {
	const u = await authUser(event);
	if (!u) return json({ error: "请先登录" }, { status: 401 });
	if (!userCan(u, "manageDevices")) return json({ error: "无权限（需设备管理档）" }, { status: 403 });

	const body = (await event.request.json().catch(() => ({}))) as Record<string, unknown>;
	const uid = String(body.uid ?? "").trim();
	const classId = String(body.classId ?? "").trim();
	if (!uid || !classId) return json({ error: "缺少 uid 或 classId" }, { status: 400 });

	if (!await assignDeviceToClass({ uid, classId, by: u.displayName || u.username }))
		return json({ error: "归班失败（设备或班级无效）" }, { status: 400 });

	await addAudit({
		actor: u.displayName || u.username,
		role: u.role,
		action: "device-assign",
		target: "console",
		detail: `归班 ${uid} → ${classId}`
	});
	return json({ ok: true, uid, classId });
}

export async function DELETE(event: RequestEvent) {
	const u = await authUser(event);
	if (!u) return json({ error: "请先登录" }, { status: 401 });
	if (!userCan(u, "manageDevices")) return json({ error: "无权限（需设备管理档）" }, { status: 403 });

	const uid = String(event.url.searchParams.get("uid") ?? "").trim();
	if (!uid) return json({ error: "缺少 uid" }, { status: 400 });

	if (!await unassignDeviceFromClass(uid)) return json({ error: "移出班级失败（设备未登记？）" }, { status: 400 });

	await addAudit({
		actor: u.displayName || u.username,
		role: u.role,
		action: "device-unassign",
		target: "console",
		detail: `移出班级 ${uid}`
	});
	return json({ ok: true, uid });
}