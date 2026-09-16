import { redirect } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { can } from "$lib/permissions.js";
import { recordActivity } from "$lib/server/activity.js";

/** 这些前缀不参与「页面浏览」活动记录（API / 静态资源 / 文件）。 */
const SKIP_PREFIX = ["/api", "/_app", "/uploads", "/favicon", "/rss.xml", "/.well-known", "/robots.txt"];

/**
 * 这些前缀的页面是「因人而异 / 不该被共享缓存」的，不套用公共缓存头。
 * 其余公开页面（博客、项目、教程、列表页…）对匿名访客是确定性的，
 * 可以放心给公共缓存，减少重复渲染压力。
 */
const NO_PUBLIC_CACHE = ["/admin", "/account", "/api", "/verify", "/register", "/u/"];

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
			// 集控面板子页面（/admin/console）走 viewConsole 门槛（L2+：
			// 电教委员/注册用户可进，L1 只读访客一律禁止 —— 集控是可控教室设备的管理面）。
			// 其余 /admin 管理页维持 viewAdmin 门槛（L4：admin / editor）。
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

	// 匿名访客访问公开内容页时套用公共缓存头：
	// 登录用户（含编辑/管理员）不缓存，避免把「带后台入口的个性化 HTML」缓存出去。
	const cacheablePublicPage =
		!user && isHtmlNav && !NO_PUBLIC_CACHE.some((p) => url.pathname.startsWith(p));
	if (cacheablePublicPage) {
		event.setHeaders({
			"Cache-Control": "public, max-age=30, s-maxage=120, stale-while-revalidate=600"
		});
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
