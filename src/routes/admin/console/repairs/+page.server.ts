import { redirect } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { userCan, canDevice } from "$lib/permissions.js";
import type { PageServerLoad } from "./$types";

// 设备报修（台账）。viewConsole 门槛（能进面板就能看台账）；
// 改状态 / 删除 / 建档由 API 侧按 canDevice(role, "manage") 二次收口。
export const load: PageServerLoad = async ({ cookies }: { cookies: import("@sveltejs/kit").Cookies }) => {
	const u = verifyToken(cookies.get("admin_token") ?? "");
	if (!u || !userCan(u, "viewConsole")) throw redirect(303, "/admin/login");
	return { role: u.role, can: { manage: canDevice(u.role, "manage") } };
};
