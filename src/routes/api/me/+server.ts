import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { verifyToken, getUser, updateProfile } from "$lib/server/auth.js";
import { recordActivity } from "$lib/server/activity.js";

/** GET /api/me —— 当前登录用户资料。 */
export function GET(event: RequestEvent) {
	const user = verifyToken(event.cookies.get("admin_token"));
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
		createdAt: user.createdAt,
		lastLoginAt: user.lastLoginAt ?? null,
		loginCount: user.loginCount ?? 0
	});
}

/** PUT /api/me —— 保存个人资料（昵称 / 邮箱 / 简介 / 头像）。 */
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
	return json({
		ok: true,
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
