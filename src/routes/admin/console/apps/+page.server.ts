import { redirect } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { userCan, canDeviceAction } from "$lib/permissions.js";
import { getCimsAccount } from "$lib/server/cims-account.js";
import type { PageServerLoad } from "./$types";

// 软件管理页（/admin/console/apps）：与集控面板同门槛 viewConsole。
//
// 只看两件事：能不能看（apps_view）、能不能关（apps_stop）。
// 两个能力位都由服务端算好下发，前端只渲染结论 —— 与 devices 页同一范式：
// 客户端不得自判能否关闭，真正的裁决在 /api/console/cims 代理的动作级闸门
// （无 apps_view 调 process_list → 403；无 apps_stop 调 process_stop → 403）。
// 注：owner/admin/homeroom 两者都有；teacher/techrep 只有 apps_view；user 都没有。
export const load: PageServerLoad = async ({ cookies }: { cookies: import("@sveltejs/kit").Cookies }) => {
	const u = verifyToken(cookies.get("admin_token") ?? "");
	if (!u || !userCan(u, "viewConsole")) throw redirect(303, "/admin/login");
	const account = await getCimsAccount();
	return {
		role: u.role,
		user: u.displayName || u.username,
		accountId: account?.id ?? "",
		can: {
			view: canDeviceAction(u.role, "apps_view"),
			stop: canDeviceAction(u.role, "apps_stop")
		}
	};
};
