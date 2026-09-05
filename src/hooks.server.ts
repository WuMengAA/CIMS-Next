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
			if (!verifyToken(token)) {
				throw redirect(303, "/admin/login");
			}
		}
	}

	return resolve(event);
}