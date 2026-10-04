import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { userCan } from "$lib/permissions.js";
import { setScheduleCell, clearScheduleCell } from "$lib/server/schedules.js";
import { addAudit } from "$lib/server/console-ext.js";

/**
 * 课表格子编辑（2026-10-05 · 课表页手动维护用）。
 *
 *  PUT    /api/console/schedule/cell  {classId, weekday, periodNo, subject, teacher, remark}  写一格
 *  DELETE /api/console/schedule/cell?classId=&weekday=&periodNo=   清一格
 *
 * 权限：manageDevices（改课表是管理操作）。
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

export async function PUT(event: RequestEvent) {
	const u = authUser(event);
	if (!u) return json({ error: "请先登录" }, { status: 401 });
	if (!userCan(u, "manageDevices")) return json({ error: "无权限（需设备管理档）" }, { status: 403 });

	const body = (await event.request.json().catch(() => ({}))) as Record<string, unknown>;
	const classId = String(body.classId ?? "").trim();
	const weekday = Number(body.weekday);
	const periodNo = Number(body.periodNo);
	if (!classId || !weekday || !periodNo) return json({ error: "缺少 classId/weekday/periodNo" }, { status: 400 });
	const subject = String(body.subject ?? "").trim();
	if (!subject) return json({ error: "科目不能为空" }, { status: 400 });

	if (!setScheduleCell(classId, weekday, periodNo, { subject, teacher: body.teacher ? String(body.teacher).trim() : "", remark: body.remark ? String(body.remark).trim() : "" }))
		return json({ error: "写入失败" }, { status: 500 });

	addAudit({
		actor: u.displayName || u.username,
		role: u.role,
		action: "schedule-cell-set",
		target: "console",
		detail: `课表 ${classId} 周${weekday}第${periodNo}节 = ${subject}`
	});
	return json({ ok: true });
}

export async function DELETE(event: RequestEvent) {
	const u = authUser(event);
	if (!u) return json({ error: "请先登录" }, { status: 401 });
	if (!userCan(u, "manageDevices")) return json({ error: "无权限（需设备管理档）" }, { status: 403 });

	const classId = String(event.url.searchParams.get("classId") ?? "").trim();
	const weekday = Number(event.url.searchParams.get("weekday") ?? 0);
	const periodNo = Number(event.url.searchParams.get("periodNo") ?? 0);
	if (!classId || !weekday || !periodNo) return json({ error: "缺少 classId/weekday/periodNo" }, { status: 400 });

	clearScheduleCell(classId, weekday, periodNo);
	addAudit({
		actor: u.displayName || u.username,
		role: u.role,
		action: "schedule-cell-clear",
		target: "console",
		detail: `课表 ${classId} 周${weekday}第${periodNo}节 清空`
	});
	return json({ ok: true });
}