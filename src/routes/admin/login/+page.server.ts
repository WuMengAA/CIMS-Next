import { fail, redirect } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";
import { verifyLogin, verifyToken, makeToken, markLogin, getUser } from "$lib/server/auth.js";
import { checkLoginLock, recordLoginFailure, clearLoginFailures } from "$lib/server/login-guard.js";
import { userCan } from "$lib/permissions.js";
import { recordActivity } from "$lib/server/activity.js";
import { loginSchema } from "$lib/schemas/login.js";

// schema 定义在 $lib/schemas/login.ts，客户端复用同一份（见该文件注释）。
export type { LoginForm } from "$lib/schemas/login.js";

/**
 * 登录后该去哪：按权限分流，而不是一律 /admin。
 * 没有 viewAdmin 的账号（如 techrep）跳 /admin 会被 hooks 弹回来，
 * 看起来就像「登录没生效」，所以这里必须挑一个它真能进的页面。
 */
function homeFor(user: { role?: string | null; titles?: string[] | null } | null): string {
	if (userCan(user as never, "viewAdmin")) return "/admin";
	if (userCan(user as never, "viewConsole")) return "/admin/console";
	return "/";
}

export const load = async ({ cookies, url }) => {
	// 已登录就别再显示登录页了（否则刷新登录页会让人以为登录状态丢了）
	const current = verifyToken(cookies.get("admin_token"));
	const target = url.searchParams.get("redirectTo");
	if (current) {
		redirect(303, target && target.startsWith("/") ? target : homeFor(current));
	}
	return { form: await superValidate(zod4(loginSchema)) };
};

export const actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		const form = await superValidate(request, zod4(loginSchema));
		if (!form.valid) return fail(400, { form });

		let ip = "";
		try { ip = getClientAddress(); } catch { /* noop */ }
		const ua = request.headers.get("user-agent") || "";

		// ── 防爆破（2026-09-27）：命中锁定直接拒绝；失败计数；成功清零 ──
		const lock = checkLoginLock(form.data.username, ip);
		if (lock.locked) {
			recordActivity({ username: form.data.username, action: "login", detail: "账号/来源已锁定，拒绝尝试", ip, userAgent: ua });
			return message(form, "尝试过于频繁，请 " + Math.ceil(lock.retryAfterSec / 60) + " 分钟后再试", { status: 429 });
		}

		const user = verifyLogin(form.data.username, form.data.password);
		if (!user) {
			recordLoginFailure(form.data.username, ip);
			// 待验证账号：给出可操作提示，而不是笼统的「用户名或密码错误」。
			const pendingUser = getUser(form.data.username);
			if (pendingUser && pendingUser.status === "pending") {
				return message(form, "账号待验证：请先完成邮箱验证再登录", { status: 403 });
			}
			return message(form, "用户名或密码错误", { status: 401 });
		}

		cookies.set("admin_token", makeToken(user, { ip, userAgent: ua }), {
			path: "/",
			httpOnly: true,
			sameSite: "strict",
			secure: false,
			maxAge: 30 * 24 * 60 * 60
		});
		markLogin(user.username, ip);
		clearLoginFailures(user.username, ip);
		recordActivity({ userId: user.id, username: user.username, action: "login", ip, userAgent: ua });
		// 按权限分流，别一律 /admin（无 viewAdmin 的账号会被 hooks 弹回登录页）
		redirect(302, homeFor(user));
	}
};
