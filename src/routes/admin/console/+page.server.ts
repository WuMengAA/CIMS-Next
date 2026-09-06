import { redirect } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { can } from "$lib/permissions.js";
import type { PageServerLoad } from "./$types";

// 集控面板子页面：仅对具备 viewConsole 的角色开放（管理员/编辑/审核员/电教委员/只读）。
// 浏览器不持有 CIMS 凭据——对 CIMS 的调用统一经 /api/console/cims 服务端代理。
export const load: PageServerLoad = ({ cookies }) => {
	const u = verifyToken(cookies.get("admin_token") ?? "");
	if (!u || !can(u.role, "viewConsole")) throw redirect(303, "/admin/login");
	return {
		role: u.role,
		can: {
			control: can(u.role, "controlDevice"),
			remote: can(u.role, "remoteControl"),
			manage: can(u.role, "manageDevices"),
		},
	};
};
