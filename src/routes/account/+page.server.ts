import { redirect } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import type { PageServerLoad } from "./$types";

// 账号页仅登录用户可见：游客直接 303 到登录页（页面壳也不暴露）
export const load: PageServerLoad = async ({ cookies }) => {
	const user = await verifyToken(cookies.get("admin_token"));
	if (!user) throw redirect(303, "/admin/login");
	return { user: { username: (await user).username, role: (await user).role } };
};
