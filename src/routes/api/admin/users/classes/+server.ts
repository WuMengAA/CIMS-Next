import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { verifyToken, getUser } from "$lib/server/auth.js";
import { userCan, classBindLimit, ROLE_LABELS, type Role } from "$lib/permissions.js";
import { listBindings, replaceBindings, validateBindingSet } from "$lib/server/class-scope.js";
import { fetchClassList } from "$lib/server/cims-client.js";
import { addAudit } from "$lib/server/console-ext.js";

/**
 * 用户 ↔ 班级绑定管理（班级系统 v2）。
 *
 *   GET  /api/admin/users/classes?username=xxx                  读某人绑定
 *   PUT  /api/admin/users/classes  {username, class_ids:[...]}  全量替换
 *   DELETE /api/admin/users/classes?username=xxx                清空绑定
 *
 * 规矩（与 class-scope.ts 同源）：
 *   · 只有 manageUsers 的管理员能改；
 *   · class_id 必须命中 CIMS /class/list 的真实班级（实时校验，绝不收自由文本）；
 *   · 限额按角色：班主任 1、电教委员 1、老师 2；站长无需绑定（-1）；其余角色 0（禁绑）；
 *   · 全量替换语义：PUT 的列表就是最终状态（改绑 = 一次调用），避免增量语义歧义。
 *   · 契约用 username（后台用户管理页只有用户名，没有数据库 id）。
 */
function resolveAdmin(event: RequestEvent) {
	const cookieToken = event.cookies.get("admin_token");
	let u = cookieToken ? verifyToken(cookieToken) : null;
	if (!u) {
		const auth = event.request.headers.get("authorization") ?? "";
		if (auth.toLowerCase().startsWith("bearer ")) u = verifyToken(auth.slice(7).trim());
	}
	if (!u) return { error: json({ error: "请先登录" }, { status: 401 }) } as const;
	if (!userCan(u, "manageUsers")) return { error: json({ error: "无权限（需要用户管理）" }, { status: 403 }) } as const;
	if (typeof u.id !== "number") return { error: json({ error: "会话无效" }, { status: 401 }) } as const;
	return { user: u } as const;
}

export async function GET(event: RequestEvent) {
	const g = resolveAdmin(event);
	if ("error" in g) return g.error;
	const username = String(event.url.searchParams.get("username") ?? "").trim();
	if (!username) return json({ error: "缺少 username" }, { status: 400 });
	const target = getUser(username);
	if (!target) return json({ error: "用户不存在" }, { status: 404 });
	return json({
		username: target.username,
		role: target.role,
		roleLabel: ROLE_LABELS[target.role as Role] ?? target.role,
		bindLimit: classBindLimit(target.role as Role),
		bindings: listBindings(target.id)
	});
}

export async function PUT(event: RequestEvent) {
	const g = resolveAdmin(event);
	if ("error" in g) return g.error;
	const admin = g.user;
	const body = await event.request.json().catch(() => ({}));
	const username = String(body.username ?? "").trim();
	if (!username) return json({ error: "缺少 username" }, { status: 400 });
	const target = getUser(username);
	if (!target) return json({ error: "用户不存在" }, { status: 404 });
	const role = target.role as Role;
	const uid = target.id;

	const limit = classBindLimit(role);
	if (limit === 0) return json({ error: `${ROLE_LABELS[role] ?? role} 没有班级绑定资格` }, { status: 400 });

	const want: string[] = Array.isArray(body.class_ids)
		? body.class_ids.map((c: unknown) => String(c).trim()).filter(Boolean)
		: [];

	// 站长：清空绑定（范围即全校），提交内容忽略。
	if (limit === -1) {
		replaceBindings(uid, [], admin.displayName || admin.username);
		return json({ ok: true, bindings: [], note: "管理员无需绑定班级（范围=全校）" });
	}

	// 真实性校验：只认 CIMS /class/list 里的班。
	const classes = await fetchClassList();
	if (!classes) {
		return json(
			{ error: "CIMS 不可达，无法校验班级真实性；为避免绑定到假班级，本次未保存" },
			{ status: 502 }
		);
	}
	const valid = new Set(classes.map((c) => String(c.class_id ?? "").toLowerCase()).filter(Boolean));
	const err = validateBindingSet(role, valid, want, listBindings(uid).length);
	if (err) return json({ error: err }, { status: 400 });

	const entries = want.map((id) => {
		const hit = classes.find((c) => String(c.class_id).toLowerCase() === id.toLowerCase());
		return { class_id: hit!.class_id, class_name: String(hit!.name ?? hit!.class_id) };
	});
	const saved = replaceBindings(uid, entries, admin.displayName || admin.username);
	addAudit({
		actor: admin.displayName || admin.username,
		role: admin.role,
		action: "class_binding",
		target: target.username,
		detail: `绑定班级：${entries.map((e) => e.class_name || e.class_id).join("、") || "（清空）"}`
	});
	return json({ ok: true, bindings: saved });
}

/** DELETE /api/admin/users/classes?username=xxx —— 清空某人绑定。 */
export async function DELETE(event: RequestEvent) {
	const g = resolveAdmin(event);
	if ("error" in g) return g.error;
	const admin = g.user;
	const username = String(event.url.searchParams.get("username") ?? "").trim();
	if (!username) return json({ error: "缺少 username" }, { status: 400 });
	const target = getUser(username);
	if (!target) return json({ error: "用户不存在" }, { status: 404 });
	replaceBindings(target.id, [], admin.displayName || admin.username);
	return json({ ok: true });
}
