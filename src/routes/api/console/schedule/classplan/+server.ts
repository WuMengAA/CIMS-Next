import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { userCan } from "$lib/permissions.js";
import { listClassSchedule } from "$lib/server/schedules.js";
import { listStelarithClasses } from "$lib/server/stelarith/classes.js";

/**
 * ClassIsland 兼容课表信封（2026-10-05 · 教室端读自有课表的桥）。
 *
 * GET /api/console/schedule/classplan?planId={classId|default_classplan}
 *  → CIMS ClassPlan 官方信封：{ ClassPlans: { guid: { Name, TimeRule:{WeekDay}, Classes:[{SubjectId, IsEnabled}] } } }
 * GET /api/console/schedule/classplan?planId=...&subjects=1
 *  → { Subjects: { guid: { Name } } }   （科目映射）
 *
 * 让 ClassIsland 数据源从 CIMS 切到站点：URL 指向本端点即读到**自有课表**（调课生效）。
 * planId=default_classplan → 第一个班；否则按 class_id 精确取。
 * 权限：viewConsole（教室端拉课表场景，管理端已登录）。
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

	const planId = String(event.url.searchParams.get("planId") ?? "").trim() || "default_classplan";
	const wantSubjects = event.url.searchParams.get("subjects") === "1";

	// 确定班级
	let classId = planId;
	if (planId === "default_classplan") {
		const classes = await listStelarithClasses();
		if (!classes.length) return json({ error: "无班级数据" }, { status: 404 });
		classId = classes[0].class_id;
	}
	// 校验班级存在
	const all = await listStelarithClasses();
	const cls = all.find((c) => c.class_id === classId);
	if (!cls) return json({ error: `班级不存在: ${classId}` }, { status: 404 });

	if (wantSubjects) {
		// 科目映射：课表里出现过的科目 → 稳定 GUID（用科目名 hash 保证可逆）
		const cells = await listClassSchedule(classId);
		const subs: Record<string, { Name: string }> = {};
		const seen = new Set<string>();
		for (const c of cells) {
			if (!c.subject || seen.has(c.subject)) continue;
			seen.add(c.subject);
			const guid = "sub_" + [...c.subject].map((ch) => ch.codePointAt(0)!.toString(16)).join("");
			subs[guid] = { Name: c.subject };
		}
		return json({ Subjects: subs });
	}

	// 主信封：ClassPlans
	const cells = await listClassSchedule(classId);
	// 分组：weekday → [{period_no, subject}]
	const byDay = new Map<number, { period: number; subject: string }[]>();
	for (const c of cells) {
		if (!c.subject) continue;
		if (!byDay.has(c.weekday)) byDay.set(c.weekday, []);
		byDay.get(c.weekday)!.push({ period: c.period_no, subject: c.subject });
	}
	const weekNames = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
	const classPlans: Record<string, unknown> = {};
	for (const [wd, items] of byDay) {
		items.sort((a, b) => a.period - b.period);
		// 每个格子的 SubjectId 用稳定 GUID（与 subjects 端点一致）
		const classes = items.map((it) => ({
			SubjectId: "sub_" + [...it.subject].map((ch) => ch.codePointAt(0)!.toString(16)).join(""),
			IsEnabled: true,
			Period: it.period
		}));
		const guid = `plan_${cls.class_id}_${wd}`;
		classPlans[guid] = {
			Name: `${cls.name} · ${weekNames[wd]}`,
			TimeRule: { WeekDay: wd },
			Classes: classes
		};
	}

	return json({ ClassPlans: classPlans });
}