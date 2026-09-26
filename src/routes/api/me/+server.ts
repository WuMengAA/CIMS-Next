import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { verifyToken, getUser, updateProfile } from "$lib/server/auth.js";
import { recordActivity } from "$lib/server/activity.js";
import { syncUserUpdateToCims } from "$lib/server/cims-account.js";
import {
	userCan,
	canDevice,
	levelLabelOfXp,
	xpToLevel,
	ROLE_LABELS,
	allowedBroadcastScopes,
	roleManagementTier,
	MANAGEMENT_TIER_LABELS,
	deviceActionsOf
} from "$lib/permissions.js";
import type { Role } from "$lib/permissions.js";
import { classScopeOf, listBindings } from "$lib/server/class-scope.js";

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
		avatar: user.avatar || "",
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
	const r = updateProfile(user.username, {
		displayName: body.displayName,
		email: body.email,
		bio: body.bio,
		avatar: body.avatar,
		className: body.className,
		gradeName: body.gradeName
	});
	if (!r.ok) return json({ error: r.error }, { status: 400 });

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
