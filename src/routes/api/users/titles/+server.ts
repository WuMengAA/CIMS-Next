import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { verifyToken, getUser, getUsers, setUserTitles } from "$lib/server/auth.js";
import { recordActivity } from "$lib/server/activity.js";
import { userCan, titlesOf, TITLES, TITLE_KEYS, type TitleKey } from "$lib/permissions.js";

/**
 * 用户称号管理端点（需 manageUsers）。
 *
 * 权限模型：等级只是显示秩位，**称号才是权限载体**。本端点让管理员为单个用户
 * 独立追加 / 撤回称号（完整覆盖写），实现「某人能做什么」的精细调控，
 * 与角色 / 等级解耦。
 *
 * GET  /api/users/titles?username=xxx  —— 某用户的称号快照（角色预设 vs 实际生效）
 * GET  /api/users/titles               —— 全部用户的称号一览（管理总览）
 * POST /api/users/titles { username, titles } —— 覆盖写该用户的称号集合（空数组 = 回退角色预设）
 */
export function GET(event: RequestEvent) {
	const { url, cookies } = event;
	const me = verifyToken(cookies.get("admin_token"));
	if (!me) return json({ error: "未登录" }, { status: 401 });
	if (!userCan(me, "viewAdmin")) return json({ error: "无权限" }, { status: 403 });

	const username = url.searchParams.get("username");
	if (username) {
		const u = getUser(username);
		if (!u) return json({ error: "用户不存在" }, { status: 404 });
		const preset = titlesOf(u.role);
		const effective = u.titles && u.titles.length ? u.titles : preset;
		const hasOverride = !!(u.titles && u.titles.length);
		return json({
			username: u.username,
			role: u.role,
			rolePresetTitles: preset,
			rolePresetLabels: preset.map((t) => TITLES[t].label),
			titles: effective,
			titleLabels: effective.map((t) => TITLES[t].label),
			hasOverride,
			allTitles: TITLE_KEYS.map((k) => ({ key: k, label: TITLES[k].label, description: TITLES[k].description }))
		});
	}

	// 全量一览：所有用户当前生效的称号（含是否覆盖角色预设）
	const users = getUsers();
	const overview = users.map((u) => {
		const preset = titlesOf(u.role);
		const effective = u.titles && u.titles.length ? u.titles : preset;
		return {
			username: u.username,
			role: u.role,
			titles: effective,
			titleLabels: effective.map((t) => TITLES[t].label),
			hasOverride: !!(u.titles && u.titles.length)
		};
	});
	// 称号目录一并下发（管理页勾选框要渲染全部称号键）。
	return json({
		users: overview,
		allTitles: TITLE_KEYS.map((k) => ({ key: k, label: TITLES[k].label, description: TITLES[k].description }))
	});
}

export async function POST(event: RequestEvent) {
	const { request, cookies } = event;
	const me = verifyToken(cookies.get("admin_token"));
	if (!me) return json({ error: "未登录" }, { status: 401 });
	if (!userCan(me, "manageUsers")) return json({ error: "无权限（需 manageUsers）" }, { status: 403 });

	let ip = "";
	try { ip = event.getClientAddress(); } catch { /* noop */ }
	const ua = request.headers.get("user-agent") || "";

	let body: any;
	try { body = await request.json(); } catch { return json({ error: "请求体解析失败" }, { status: 400 }); }

	const username = (body.username || "").trim();
	if (!username) return json({ error: "缺少 username" }, { status: 400 });
	const target = getUser(username);
	if (!target) return json({ error: "用户不存在" }, { status: 404 });
	if (target.username === "admin") {
		return json({ error: "内置管理员不可通过此接口改称号" }, { status: 403 });
	}

	// 校验标题键合法（setUserTitles 内部也会再过滤一次，这里先拦截非法值）
	const titles = Array.isArray(body.titles) ? (body.titles as string[]) : null;
	if (titles === null) return json({ error: "titles 必须是数组" }, { status: 400 });
	const valid = new Set<string>(TITLE_KEYS);
	const clean = Array.from(new Set(titles.filter((t: string) => valid.has(t)))) as TitleKey[];

	const hadOverride = !!(target.titles && target.titles.length);
	setUserTitles(target.id!, clean);
	const effective = clean.length ? clean : titlesOf(target.role);

	recordActivity({
		userId: me.id,
		username: me.username,
		action: "user_titles_set",
		target: username,
		detail: `覆盖写称号：${clean.join(",") || "(空→回退角色预设" + titlesOf(target.role).join(",") + ")"}`,
		ip,
		userAgent: ua
	});

	return json({
		ok: true,
		username,
		role: target.role,
		titles: effective,
		titleLabels: effective.map((t) => TITLES[t].label),
		hasOverride: clean.length > 0
	});
}
