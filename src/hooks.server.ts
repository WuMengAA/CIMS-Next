import { redirect } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";

export function handle({ event, resolve }) {
	const url = event.url;

	// Protect all /admin routes except login and API auth
	if (url.pathname.startsWith("/admin")) {
		const isLogin = url.pathname === "/admin/login";
		const isAuthApi = url.pathname.startsWith("/api/auth");
		if (!isLogin && !isAuthApi) {
			const token = event.cookies.get("admin_token");
			const u = verifyToken(token);
			// 必须登录且具备编辑权限（admin / editor）。普通读者或无角色一律弹登录，
			// 落实多用户：不同角色看到不同界面，编辑入口不是谁都能进。
			if (!u || (u.role !== "admin" && u.role !== "editor")) {
				throw redirect(303, "/admin/login");
			}
		}
	}

	return resolve(event);
}