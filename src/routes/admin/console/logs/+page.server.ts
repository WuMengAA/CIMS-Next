import { redirect } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { userCan, canDeviceAction } from "$lib/permissions.js";
import { getCimsAccount } from "$lib/server/cims-account.js";
import type { PageServerLoad } from "./$types";

// 设备日志页（/admin/console/logs）：与集控面板同门槛 viewConsole。
//
// 只看一件事：能不能看日志（logs_view）。能力位由服务端算好下发，前端只渲染结论 ——
// 与 apps 页同一范式：客户端不得自判，真正的裁决有两道服务端闸门：
//   ① /api/console/sign-task —— 无 logs_view 给 log_tail 签不出名；
//   ② /api/console/cims 代理   —— 无 logs_view 的 log_tail 直接被 403（人话文案）。
// 注：owner/admin/homeroom/teacher/techrep 都有 logs_view；user/viewer/editor/moderator 没有。
export const load: PageServerLoad = async ({ cookies }: { cookies: import("@sveltejs/kit").Cookies }) => {
	const u = verifyToken(cookies.get("admin_token") ?? "");
	if (!u || !userCan(u, "viewConsole")) throw redirect(303, "/admin/login");
	const account = await getCimsAccount();
	return {
		role: u.role,
		user: u.displayName || u.username,
		accountId: account?.id ?? "",
		can: {
			view: canDeviceAction(u.role, "logs_view")
		}
	};
};
