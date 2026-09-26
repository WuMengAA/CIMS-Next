import { redirect } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { userCan, canDevice } from "$lib/permissions.js";
import type { PageServerLoad } from "./$types";

// 监控设置页：与集控面板同门槛 viewConsole；保存操作由服务端 ext 端点再强制 manage 档。
export const load: PageServerLoad = async ({ cookies }: { cookies: import("@sveltejs/kit").Cookies }) => {
	const u = verifyToken(cookies.get("admin_token") ?? "");
	if (!u || !userCan(u, "viewConsole")) throw redirect(303, "/admin/login");
	return {
		role: u.role,
		canManage: canDevice(u.role, "manage"),
	};
};
