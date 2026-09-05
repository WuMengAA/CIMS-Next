import { fail, redirect } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";
import { z } from "zod";
import { verifyLogin, makeToken } from "$lib/server/auth.js";

const schema = z.object({
	username: z.string().min(1, "请输入用户名"),
	password: z.string().min(1, "请输入密码")
});

export type LoginForm = typeof schema;

export const load = async () => {
	return { form: await superValidate(zod4(schema)) };
};

export const actions = {
	default: async ({ request, cookies }) => {
		const form = await superValidate(request, zod4(schema));
		if (!form.valid) return fail(400, { form });

		const user = verifyLogin(form.data.username, form.data.password);
		if (!user) {
			return message(form, "用户名或密码错误", { status: 401 });
		}

		cookies.set("admin_token", makeToken(user), {
			path: "/",
			httpOnly: true,
			sameSite: "strict",
			secure: false
		});
		redirect(302, "/admin");
	}
};
