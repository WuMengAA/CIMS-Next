import { redirect } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { can } from "$lib/permissions.js";
import { recordActivity } from "$lib/server/activity.js";

/** 这些前缀不参与「页面浏览」活动记录（API / 静态资源 / 文件）。 */
const SKIP_PREFIX = ["/api", "/_app", "/uploads", "/favicon", "/rss.xml", "/.well-known", "/robots.txt"];

export async function handle({ event, resolve }) {
	const url = event.url;
	let user = null;

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
			user = u;
		}
	}

	// 惰性识别登录态（仅页面级导航，避免给 API / 静态资源增加无谓查询）
	const isHtmlNav =
		event.request.method === "GET" &&
		!SKIP_PREFIX.some((p) => url.pathname.startsWith(p)) &&
		(event.request.headers.get("accept") || "").includes("text/html");
	if (!user && isHtmlNav) {
		try {
			user = verifyToken(event.cookies.get("admin_token"));
		} catch { /* noop */ }
	}

	const response = await resolve(event);

	// 多用户活动：记录页面浏览（内存节流，同一用户同一路径 2 分钟内只落一条）
	if (user && isHtmlNav) {
		try {
			let ip = "";
			try { ip = event.getClientAddress(); } catch { /* 某些适配器不支持 */ }
			recordActivity(
				{
					userId: user.id,
					username: user.username,
					action: "view",
					target: url.pathname,
					ip,
					userAgent: event.request.headers.get("user-agent") || ""
				},
				{ throttle: true }
			);
		} catch { /* noop */ }
	}

	return response;
}
