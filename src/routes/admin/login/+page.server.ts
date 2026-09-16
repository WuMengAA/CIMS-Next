import { fail, redirect } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";
import { verifyLogin, makeToken, markLogin, getUser } from "$lib/server/auth.js";
import { recordActivity } from "$lib/server/activity.js";
import { loginSchema } from "$lib/schemas/login.js";

// schema 定义在 $lib/schemas/login.ts，客户端复用同一份（见该文件注释）。
export type { LoginForm } from "$lib/schemas/login.js";

export const load = async () => {
	return { form: await superValidate(zod4(loginSchema)) };
};

export const actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		const form = await superValidate(request, zod4(loginSchema));
		if (!form.valid) return fail(400, { form });

		const user = verifyLogin(form.data.username, form.data.password);
		if (!user) {
			// 待验证账号：给出可操作提示，而不是笼统的「用户名或密码错误」。
			const pendingUser = getUser(form.data.username);
			if (pendingUser && pendingUser.status === "pending") {
				return message(form, "账号待验证：请先完成邮箱验证再登录", { status: 403 });
			}
			return message(form, "用户名或密码错误", { status: 401 });
		}

		let ip = "";
		try { ip = getClientAddress(); } catch { /* noop */ }
		const ua = request.headers.get("user-agent") || "";

		cookies.set("admin_token", makeToken(user, { ip, userAgent: ua }), {
			path: "/",
			httpOnly: true,
			sameSite: "strict",
			secure: false,
			maxAge: 30 * 24 * 60 * 60
		});
		markLogin(user.username, ip);
		recordActivity({ userId: user.id, username: user.username, action: "login", ip, userAgent: ua });
		redirect(302, "/admin");
	}
};
