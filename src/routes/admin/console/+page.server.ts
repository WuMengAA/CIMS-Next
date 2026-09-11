import { redirect } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { can } from "$lib/permissions.js";
import { getCimsAccount } from "$lib/server/cims-account.js";
import type { PageServerLoad } from "./$types";

// 集控面板子页面：仅对具备 viewConsole 的角色开放（管理员/编辑/审核员/电教委员/只读）。
// 浏览器不持有 CIMS 凭据——对 CIMS 的调用统一经 /api/console/cims 服务端代理。
// 这里同时把「角色 + 已解算的权限位」下发给面板，使面板能按权限禁用/隐藏操作，
// 而不是让只读账号也看到一屏可点但会被服务端拒绝的按钮。
export const load: PageServerLoad = async ({ cookies }) => {
	const u = verifyToken(cookies.get("admin_token") ?? "");
	if (!u || !can(u.role, "viewConsole")) throw redirect(303, "/admin/login");
	// 取 CIMS 首个账户的 id，注入面板作为操作上下文（否则内嵌态 accountId 为空、
	// canUseBackend() 恒 false，所有 cims() 静默降级演示数据）。
	const account = await getCimsAccount();
	return {
		role: u.role,
		user: u.displayName || u.username,
		can: {
			control: can(u.role, "controlDevice"),
			remote: can(u.role, "remoteControl"),
			manage: can(u.role, "manageDevices"),
			issue: can(u.role, "submitIssue")
		},
		accountId: account?.id ?? ""
	};
};
