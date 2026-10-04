import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { userCan } from "$lib/permissions.js";
import {
	createStelarithClass,
	updateStelarithClass,
	deleteStelarithClass,
	type StelarithClass
} from "$lib/server/stelarith/classes.js";
import { addAudit } from "$lib/server/console-ext.js";

/**
 * 班级管理写操作（2026-10-04 · 彻底去 CIMS：/class/create 等 CIMS 后端操作的自有替代）。
 *
 *  POST  /api/class          建班 {name, code?}  → 201 {class}
 *  PATCH /api/class          改班 {classId, name?, code?} → 200 {class}
 *  DELETE /api/class?classId=  删班 → 200 {deleted} / 409 {blockedByDevices}
 *
 * 权限：manage（设备管理档）——建/删班是全校级操作，不给普通用户。
 * 删班保护：班里还有 active 设备 → 409 拒绝（防孤儿绑定）。
 */

function authUser(event: RequestEvent) {
	const cookieToken = event.cookies.get("admin_token");
	let u = cookieToken ? verifyToken(cookieToken) : null;
	if (!u) {
		const auth = event.request.headers.get("authorization") ?? "";
		if (auth.toLowerCase().startsWith("bearer ")) u = verifyToken(auth.slice(7).trim());
	}
	return u;
}

export async function POST(event: RequestEvent) {
	const u = authUser(event);
	if (!u) return json({ error: "请先登录" }, { status: 401 });
	if (!userCan(u, "manageDevices")) return json({ error: "无权限（需设备管理档）" }, { status: 403 });

	const body = (await event.request.json().catch(() => ({}))) as Record<string, unknown>;
	const name = String(body.name ?? "").trim();
	if (!name) return json({ error: "缺少班级名" }, { status: 400 });

	const cls = createStelarithClass({ name, code: body.code ? String(body.code).trim() : undefined });
	if (!cls) return json({ error: "建班失败（名字可能重复）" }, { status: 409 });

	addAudit({
		actor: u.displayName || u.username,
		role: u.role,
		action: "class-create",
		target: "console",
		detail: `建班 ${cls.name} (${cls.class_id})`
	});
	return json({ class: cls }, { status: 201 });
}

export async function PATCH(event: RequestEvent) {
	const u = authUser(event);
	if (!u) return json({ error: "请先登录" }, { status: 401 });
	if (!userCan(u, "manageDevices")) return json({ error: "无权限（需设备管理档）" }, { status: 403 });

	const body = (await event.request.json().catch(() => ({}))) as Record<string, unknown>;
	const classId = String(body.classId ?? "").trim();
	if (!classId) return json({ error: "缺少 classId" }, { status: 400 });

	const cls = updateStelarithClass(classId, {
		name: body.name !== undefined ? String(body.name).trim() : undefined,
		code: body.code !== undefined ? String(body.code).trim() : undefined
	});
	if (!cls) return json({ error: "改班失败（查不到或名字重复）" }, { status: 409 });

	addAudit({
		actor: u.displayName || u.username,
		role: u.role,
		action: "class-update",
		target: "console",
		detail: `改班 ${cls.name} (${cls.class_id})`
	});
	return json({ class: cls });
}

export async function DELETE(event: RequestEvent) {
	const u = authUser(event);
	if (!u) return json({ error: "请先登录" }, { status: 401 });
	if (!userCan(u, "manageDevices")) return json({ error: "无权限（需设备管理档）" }, { status: 403 });

	const classId = String(event.url.searchParams.get("classId") ?? "").trim();
	if (!classId) return json({ error: "缺少 classId" }, { status: 400 });

	const r = deleteStelarithClass(classId);
	if (!r.deleted) {
		if (r.notFound) return json({ error: "班级不存在" }, { status: 404 });
		if (r.blockedByDevices)
			return json({ error: `班内还有 ${r.blockedByDevices} 台设备，不能删除（先移出设备）` }, { status: 409 });
		return json({ error: "删班失败" }, { status: 500 });
	}

	addAudit({
		actor: u.displayName || u.username,
		role: u.role,
		action: "class-delete",
		target: "console",
		detail: `删班 ${classId}`
	});
	return json({ deleted: true, classId });
}

export type { StelarithClass };