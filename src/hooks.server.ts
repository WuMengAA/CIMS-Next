import { redirect } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { can } from "$lib/permissions.js";

export function handle({ event, resolve }) {
	const url = event.url;

		// Protect all /admin routes except login and API auth
	if (url.pathname.startsWith("/admin")) {
		const isLogin = url.pathname === "/admin/login";
		const isAuthApi = url.pathname.startsWith("/api/auth");
		if (!isLogin && !isAuthApi) {
			const token = event.cookies.get("admin_token");
			const u = verifyToken(token);
			// 集控面板子页面（/admin/console）仅需 viewConsole（电教委员/只读亦可进入）；
			// 其余 /admin 管理页维持 viewAdmin 门槛（admin / editor）。
			const needConsole = url.pathname.startsWith("/admin/console");
			const ok = u && (needConsole ? can(u.role, "viewConsole") : can(u.role, "viewAdmin"));
			if (!ok) {
				throw redirect(303, "/admin/login");
			}
		}
	}

	return resolve(event);
}