import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { userCan } from "$lib/permissions.js";
import {
	listTimetable,
	listClassSchedule,
	listSwapRequests,
	createSwapRequest,
	reviewSwap
} from "$lib/server/schedules.js";
import { addAudit } from "$lib/server/console-ext.js";

/**
 * 课表 + 调课（2026-10-05 · 定位 v2：课表按班、作息全校共用；调课/换课是含金量）。
 *
 *  GET   /api/console/schedule?classId=    → { timetable, schedule, swaps }
 *  POST  /api/console/schedule            调课申请 {classId, fromWeekday, fromPeriod, toWeekday, toPeriod, reason}
 *  PATCH /api/console/schedule?action=approve|reject&id=   审批调课
 *
 * 权限：GET viewConsole（看课表是基础）；POST manageDevices（调课改全校课表）；
 *      PATCH manageDevices（审批是管理操作）。
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

export async function GET(event: RequestEvent) {
	const u = authUser(event);
	if (!u) return json({ error: "请先登录" }, { status: 401 });
	if (!userCan(u, "viewConsole")) return json({ error: "无权限" }, { status: 403 });

	const classId = String(event.url.searchParams.get("classId") ?? "").trim();
	const timetable = listTimetable();
	const schedule = classId ? listClassSchedule(classId) : [];
	const swaps = listSwapRequests();

	return json({ timetable, schedule, swaps, classId });
}

export async function POST(event: RequestEvent) {
	const u = authUser(event);
	if (!u) return json({ error: "请先登录" }, { status: 401 });
	if (!userCan(u, "manageDevices")) return json({ error: "无权限（需设备管理档）" }, { status: 403 });

	const body = (await event.request.json().catch(() => ({}))) as Record<string, unknown>;
	const r = createSwapRequest({
		classId: String(body.classId ?? ""),
		fromWeekday: Number(body.fromWeekday),
		fromPeriod: Number(body.fromPeriod),
		toWeekday: Number(body.toWeekday),
		toPeriod: Number(body.toPeriod),
		reason: body.reason ? String(body.reason) : "",
		requestedBy: u.displayName || u.username
	});
	if (!r.ok) return json({ error: r.error }, { status: 400 });

	addAudit({
		actor: u.displayName || u.username,
		role: u.role,
		action: "schedule-swap-request",
		target: "console",
		detail: `调课申请：${body.classId} 周${body.fromWeekday}第${body.fromPeriod}节 → 周${body.toWeekday}第${body.toPeriod}节`
	});
	return json({ ok: true, swap: r.swap }, { status: 201 });
}

export async function PATCH(event: RequestEvent) {
	const u = authUser(event);
	if (!u) return json({ error: "请先登录" }, { status: 401 });
	if (!userCan(u, "manageDevices")) return json({ error: "无权限（需设备管理档）" }, { status: 403 });

	const action = String(event.url.searchParams.get("action") ?? "");
	const id = Number(event.url.searchParams.get("id") ?? 0);
	if (!["approve", "reject"].includes(action) || !id) return json({ error: "缺少 action 或 id" }, { status: 400 });

	const r = reviewSwap(id, action as "approve" | "reject", u.displayName || u.username);
	if (!r.ok) return json({ error: r.error }, { status: 400 });

	addAudit({
		actor: u.displayName || u.username,
		role: u.role,
		action: action === "approve" ? "schedule-swap-approve" : "schedule-swap-reject",
		target: "console",
		detail: `${action === "approve" ? "批准" : "驳回"}调课 #${id}`
	});
	return json({ ok: true });
}