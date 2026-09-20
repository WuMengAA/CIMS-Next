import { redirect } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { can, userCan } from "$lib/permissions.js";
import type { PageServerLoad } from "./$types";

// 班级绑定引导页：仅对具备 viewConsole 的角色开放（与集控面板同一门槛，L2+；
// L1 只读访客一律禁止，不会走到这一步）。
// 绑定页本身**不该**再被「未绑定 -> redirect」拦——本页就是用来绑定的，
// 因此这里只做登录 + viewConsole 校验，不检查 className。
export const load: PageServerLoad = ({ cookies }) => {
	const u = verifyToken(cookies.get("admin_token") ?? "");
	if (!u || !userCan(u, "viewConsole")) throw redirect(303, "/admin/login");
	// 站长（owner/admin）能进面板不需要绑定，若误入此页直接放回面板
	if (["owner", "admin"].includes(u.role)) throw redirect(303, "/admin/console");
	return {
		username: u.username,
		displayName: u.displayName || u.username,
		className: u.className || "",
		gradeName: u.gradeName || ""
	};
};