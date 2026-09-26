import { redirect } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { userCan, canDevice, isConsoleReadOnly } from "$lib/permissions.js";
import { getCimsAccount } from "$lib/server/cims-account.js";
import type { PageServerLoad } from "./$types";

// 设备页（Svelte 版，2026-09-26 从原生面板迁移）：与集控面板同门槛 viewConsole，
// 服务端把角色 + 设备轴权限位 + 操作账户下发，前端据此渲染（只读态隐藏写按钮）。
export const load: PageServerLoad = async ({ cookies }: { cookies: import("@sveltejs/kit").Cookies }) => {
	const u = verifyToken(cookies.get("admin_token") ?? "");
	if (!u || !userCan(u, "viewConsole")) throw redirect(303, "/admin/login");
	const account = await getCimsAccount();
	return {
		role: u.role,
		readonly: isConsoleReadOnly(u.role),
		user: u.displayName || u.username,
		accountId: account?.id ?? "",
		can: {
			control: canDevice(u.role, "control"),
			remote: canDevice(u.role, "remote"),
			manage: canDevice(u.role, "manage"),
		},
	};
};
