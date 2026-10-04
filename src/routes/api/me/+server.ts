import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { verifyToken, getUser, updateProfile, sanitizeAvatar, verifyLogin } from "$lib/server/auth.js";
import { recordActivity } from "$lib/server/activity.js";
import { syncUserUpdateToCims } from "$lib/server/cims-account.js";
import { listStelarithClasses, type StelarithClass } from "$lib/server/stelarith/classes.js";
import { classScopeOf, listBindings, replaceBindings } from "$lib/server/class-scope.js";
import {
	userCan,
	canDevice,
	classBindLimit,
	levelLabelOfXp,
	xpToLevel,
	ROLE_LABELS,
	allowedBroadcastScopes,
	roleManagementTier,
	MANAGEMENT_TIER_LABELS,
	deviceActionsOf
} from "$lib/permissions.js";
import type { Role } from "$lib/permissions.js";

/**
 * 取当前登录用户：先认浏览器 Cookie（网页），再认 Bearer 令牌（桌面端）。
 *
 * 桌面客户端经 OAuth 拿到的是令牌、没有 Cookie，所以必须支持 Authorization 头；
 * 否则桌面端永远读不到自己的身份，也就没法按身份适配界面。
 */
function resolveUser(event: RequestEvent) {
	const cookieToken = event.cookies.get("admin_token");
	if (cookieToken) {
		const u = verifyToken(cookieToken);
		if (u) return u;
	}
	const auth = event.request.headers.get("authorization") ?? "";
	if (auth.toLowerCase().startsWith("bearer ")) {
		return verifyToken(auth.slice(7).trim());
	}
	return null;
}

/**
 * 身份快照：**服务端解算好再下发**。
 *
 * 前端（网页面板 / 桌面客户端）一律不得自行从 role 推导能力 —— 推导逻辑一旦
 * 分叉，就会出现「界面点得了、服务端拒绝」或反过来的错位。这里与集控面板
 * `/admin/console` 用同一套函数（userCan / canDevice / allowedBroadcastScopes），
 * 保证两边看到的"我能做什么"永远一致。
 */
function identityOf(u: NonNullable<ReturnType<typeof verifyToken>>) {
	const role = u.role as Role | null | undefined;
	const tier = roleManagementTier(role);
	const xp = u.xp ?? 0;
	// v2（班级系统 2026-09-25）：动作矩阵与班级范围由服务端一次算清。
	// 前端（含 Flutter 桌面端）只准消费这里的结果，不允许自己从 role 推导
	// —— 推导分叉就会出现「界面能点、服务端 403」的错位。
	const scope = classScopeOf(role, u.id ?? null);
	const actions = deviceActionsOf(role);
	return {
		role: role ?? null,
		roleLabel: role ? ROLE_LABELS[role] : "未登录",
		// 经验等级（#248：xp→Lv，与角色零耦合；未登录按 0）
		xp,
		level: xpToLevel(xp),
		levelLabel: levelLabelOfXp(xp),
		className: u.className || "",
		gradeName: u.gradeName || "",
		// v2：结构化班级绑定（真实 class_id 列表；"-" 表示全校无需绑定）
		classScope: scope,
		classes: scope === "*" ? [] : listBindings(u.id ?? 0),
		deviceActions: actions,
		can: {
			watch: canDevice(role, "watch") || actions.includes("watch"),
			control: canDevice(role, "control"),
			remote: canDevice(role, "remote"),
			manage: canDevice(role, "manage"),
			playback: actions.includes("playback") || actions.includes("watch"),
			voice: actions.includes("voice"),
			notify: actions.includes("notify"),
			file: actions.includes("file"),
			shutdown: actions.includes("shutdown"),
			// 软件管控（2026-10-01 补）：这两个键此前**只**出现在 deviceActions 数组里、
			// 不在 can 映射里 —— 而 Flutter 的 Identity.fromJson 只读 can、连 deviceActions
			// 都没读，导致 App 端拿不到"能不能看/关运行软件"（P2-5 的口径缺口，
			// 功能级验证已实证）。与上方 shutdown 同源，都从 actions（服务端已按角色算好）取。
			apps_view: actions.includes("apps_view"),
			apps_stop: actions.includes("apps_stop"),
			issue: userCan(u, "submitIssue")
		},
		broadcastScopes: allowedBroadcastScopes(role),
		managementTier: tier,
		managementTierLabel: tier ? MANAGEMENT_TIER_LABELS[tier] : "—"
	};
}

/** GET /api/me —— 当前登录用户资料 + 身份快照（Cookie 或 Bearer 均可）。 */
export function GET(event: RequestEvent) {
	const user = resolveUser(event);
	if (!user) return json(null);
	return json({
		username: user.username,
		displayName: user.displayName,
		email: user.email || "",
		bio: user.bio || "",
		avatar: sanitizeAvatar(user.avatar),
		role: user.role,
		className: user.className || "",
		gradeName: user.gradeName || "",
		xp: user.xp ?? 0,
		createdAt: user.createdAt,
		lastLoginAt: user.lastLoginAt ?? null,
		loginCount: user.loginCount ?? 0,
		// 身份快照：桌面端 / 面板据它决定"摆什么、藏什么"
		identity: identityOf(user)
	});
}

/** PUT /api/me —— 保存个人资料（昵称 / 邮箱 / 简介 / 头像 / 班级 / 年级）。 */
export async function PUT(event: RequestEvent) {
	const { request, cookies } = event;
	const user = verifyToken(cookies.get("admin_token"));
	if (!user) return json({ error: "未登录" }, { status: 401 });

	const body = await request.json().catch(() => ({}));

	// 安全网补强（2026-09-27）：改邮箱 = 敏感操作（邮箱是找回密码/账号身份凭证），
	// 必须提交当前密码做二次验证，防会话被盗后静默改绑邮箱劫持账号。
	const changingEmail = typeof body.email === "string" && body.email !== (user as unknown as { email?: string }).email;
	if (changingEmail) {
		if (!verifyLogin(user.username, String(body.currentPassword || ""))) {
			return json({ error: "修改邮箱需先验证当前密码", currentPasswordRequired: true }, { status: 400 });
		}
	}

	const r = updateProfile(user.username, {
		displayName: body.displayName,
		email: body.email,
		bio: body.bio,
		avatar: body.avatar,
		className: body.className,
		gradeName: body.gradeName
	});
	if (!r.ok) return json({ error: r.error }, { status: 400 });

	// ── v2 班级绑定同步（B03 修复，2026-09-25）──────────────────────────────
	// 绑班页（/admin/console/bind）与资料页提交的 className 是「班级名」，
	// 而 v2 范围判定的权威来源是 user_class_bindings 表（真实 class_id）。
	// 此前只写 users.class_name、不写绑定表 → 班主任绑了班，classScope 仍空，
	// 面板里看不到本班设备（仅靠旧数字启发式碰运气）。这里把两者接齐：
	// className 非空 → 匹配 CIMS 真实班级写 bindings；为空 → 清空 bindings。
	const patchClassName = body.className !== undefined ? String(body.className).trim() : undefined;
	if (patchClassName !== undefined && classBindLimit(user.role as never) > 0) {
		try {
			if (patchClassName) {
				// 2026-10-04：班级真源切自有表（stelarith_classes）；本地为空回退 CIMS 兜底
				let classes = listStelarithClasses();
				if (!classes.length) {
					try {
						const { fetchClassList } = await import("$lib/server/cims-client.js");
						const cims = (await fetchClassList()) ?? [];
						// CIMS 兜底：形状转成自有 StelarithClass（school_id 补默认）
						classes = cims.map((c, i) => ({
							class_id: String(c.class_id ?? ""),
							name: String(c.name ?? c.class_id ?? ""),
							code: String(c.code ?? ""),
							sort_order: i,
							school_id: "",
							created_at: new Date().toISOString()
						}));
					} catch { /* 本地与 CIMS 都不可达：跳过绑定，保持旧行为 */ }
				}
				if (classes.length) {
					const hit = matchClass(classes, patchClassName);
					if (hit) {
						replaceBindings(user.id ?? 0, [{ class_id: hit.class_id, class_name: patchClassName }], user.displayName || user.username);
					}
				}
			} else {
				replaceBindings(user.id ?? 0, [], user.displayName || user.username);
			}
		} catch {
			// CIMS 不可达 / 匹配失败：保持旧行为（只写 className，数字启发式兜底），
			// 不阻断资料保存；管理员仍可在用户管理页手工绑定。
		}
	}

	let ip = "";
	try { ip = event.getClientAddress(); } catch { /* noop */ }
	recordActivity({
		userId: user.id,
		username: user.username,
		action: "profile_update",
		target: user.username,
		ip,
		userAgent: request.headers.get("user-agent") || ""
	});

	const fresh = getUser(user.username);

	// 镜像到 CIMS（账号跟随 website 同步）。班级/年级是集控侧「这台设备属于哪个班」
	// 的账号维度依据 —— 电教委员改了班级，CIMS 侧要同步，否则设备归属与人对不上。
	// fail-open：CIMS 不可达不影响资料保存结果，响应里带 sync 字段说明。
	let sync: Awaited<ReturnType<typeof syncUserUpdateToCims>> | null = null;
	if (fresh?.email) {
		sync = await syncUserUpdateToCims({
			email: fresh.email,
			username: fresh.username,
			displayName: fresh.displayName,
			className: fresh.className || "",
			gradeName: fresh.gradeName || ""
		});
	}

	return json({
		ok: true,
		sync,
		user: fresh
	? {
				username: fresh.username,
				displayName: fresh.displayName,
				email: fresh.email,
				bio: fresh.bio,
				avatar: fresh.avatar,
				role: fresh.role,
				className: fresh.className || "",
				gradeName: fresh.gradeName || "",
				createdAt: fresh.createdAt,
				lastLoginAt: fresh.lastLoginAt ?? null,
				loginCount: fresh.loginCount ?? 0
			}
		: null
	});
}

/**
 * 把绑班页/d资料页提交的「班级名」匹配到 CIMS 真实班级（class_id）。
 * 匹配优先级（与绑班页下拉同源）：
 *   1. name 精确相等（绑班页 option value 就是 name，如「3班」）；
 *   2. code / display_code 精确相等；
 *   3. 数字归一相等（「3班」↔「2025届3班」），仅当唯一命中时采纳，
 *      避免「1班」误配到「10班/11班…」。
 * 匹配不到返回 null → 调用方保持旧行为，不写 bindings。
 */
function matchClass(classes: StelarithClass[], className: string): StelarithClass | null {
	const c = className.trim();
	if (!c) return null;
	for (const cls of classes) {
		if (String(cls.name ?? "") === c) return cls;
		if (String(cls.code ?? "") === c) return cls;
	}
	// 数字归一：两边都压成纯数字串再比（「3班」→"3"，「2025届3班」→"20253"，
	// 前缀届级不影响；注意「2025届3班」归一后是 "20253"，与 "3" 不相等，
	// 所以额外做一次"取尾号"匹配：class_id/name 里的末位数字段等于 c 的末位。
	const cTail = (c.match(/\d+$/)?.[0] ?? "").trim();
	if (!cTail) return null;
	const hits = classes.filter((cls) => {
		const n = String(cls.name ?? "");
		const id = String(cls.class_id ?? "");
		return (
			(id.match(/\d+/g) || []).some((d) => d === cTail) ||
			(n.match(/\d+/g) || []).some((d) => d === cTail)
		);
	});
	return hits.length === 1 ? hits[0] : null;
}
