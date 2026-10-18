import { redirect } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { userCan, canDevice, allowedBroadcastScopes } from "$lib/permissions.js";
import type { PageServerLoad } from "./$types";

// 发布通知（Svelte 版）：viewConsole 门槛 + 广播范围下发（服务端强制收敛可达范围）。
export const load: PageServerLoad = async ({ cookies }: { cookies: import("@sveltejs/kit").Cookies }) => {
	const u = await verifyToken(cookies.get("admin_token") ?? "");
	if (!u || !userCan(u, "viewConsole")) throw redirect(303, "/admin/login");
	return {
		role: u.role,
		user: u.displayName || u.username,
		className: u.className || "",
		gradeName: u.gradeName || "",
		broadcast: canDevice(u.role, "control") || userCan(u, "sendBroadcast"),
		broadcastScopes: allowedBroadcastScopes(u.role),
	};
};
