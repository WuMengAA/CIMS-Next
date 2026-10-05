import { error, redirect } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { can, userCan } from "$lib/permissions.js";
import { recordActivity } from "$lib/server/activity.js";
import { startScheduledBroadcastScheduler } from "$lib/server/scheduled-broadcast-scheduler.js";

/** 启动时挂载：定时广播调度器（每 30s 扫描到点任务 → 云端 notify 通道）。 */
export const init = () => {
	startScheduledBroadcastScheduler();
};

/** 这些前缀不参与「页面浏览」活动记录（API / 静态资源 / 文件）。 */
const SKIP_PREFIX = ["/api", "/_app", "/uploads", "/favicon", "/rss.xml", "/.well-known", "/robots.txt"];

/**
 * 这些前缀的页面是「因人而异 / 不该被共享缓存」的，不套用公共缓存头。
 * 其余公开页面（博客、项目、教程、列表页…）对匿名访客是确定性的，
 * 可以放心给公共缓存，减少重复渲染压力。
 */
const NO_PUBLIC_CACHE = ["/admin", "/account", "/api", "/verify", "/register", "/u/"];

/**
 * /admin 前缀下的**静态资源**白名单：不参与登录态校验，最先判定（先于登录校验与
 * 路由门槛）。若把 /admin/_app/** 一起 303 到登录页，未登录时后台客户端入口拿不到，
 * hydration 完全起不来 → onMount 不执行 → 集控面板退回浏览器默认 300×150。
 * 只放行「文件形态」的路径，因此绝不会命中 /admin/login、/admin/console 这类页面路由。
 */
const ADMIN_STATIC_PATTERNS = [
	/^\/admin\/_app\//,
	/^\/admin\/favicon\.(?:ico|png)$/i,
	/^\/admin\/[^/?#]*\.(?:js|mjs|cjs|css|json|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot|map|txt|webmanifest)$/i
];

export async function handle({ event, resolve }) {
	const url = event.url;
	let user = null;

	// Protect all /admin routes except login, static assets and API auth
	if (url.pathname.startsWith("/admin")) {
		const isStaticAsset = ADMIN_STATIC_PATTERNS.some((re) => re.test(url.pathname));
		const isLogin = url.pathname === "/admin/login";
		const isAuthApi = url.pathname.startsWith("/api/auth");
		if (!isLogin && !isAuthApi && !isStaticAsset) {
			const token = event.cookies.get("admin_token");
			const u = verifyToken(token, event.request.headers.get("user-agent"));
			// 集控面板子页面（/admin/console）走 viewConsole 门槛（L2+：
			// 电教委员/注册用户可进，L1 只读访客一律禁止 —— 集控是可控教室设备的管理面）。
			// 其余 /admin 管理页维持 viewAdmin 门槛（L4：admin / editor）。
			const needConsole = url.pathname.startsWith("/admin/console");
			const ok = u && (needConsole ? userCan(u, "viewConsole") : userCan(u, "viewAdmin"));
			if (!ok) {
				// 登录后要回到用户原本想去的页面（含查询串），而不是后台首页——
				// 未登录时在前台点「编辑」被拦下，登录完却落到 /admin，那一篇就丢了。
				// 只带 pathname + search，不带 origin：本站内部跳转不需要绝对地址，
				// 也就不给「外部地址被塞进来」留缝（客户端还会再做一次站内校验）。
				const returnTo = url.pathname + url.search;
				// 已登录但权限不足时**绝不能再丢回登录页**——用户会以为「登录没生效」，
				// 于是反复登录（实测：同一账号 3 分钟内连登 4 次，全是这个假象造成的）。
				// 有集控面板权限的送去面板，其余给明确的 403，而不是假装未登录。
				// 两种情况都捎上 returnTo：会话过期后若再兜到登录页，目标不丢。
				if (u && userCan(u, "viewConsole"))
					throw redirect(303, "/admin/console?returnTo=" + encodeURIComponent(returnTo));
				if (u) throw error(403, "当前账号没有后台管理权限");
				throw redirect(303, "/admin/login?returnTo=" + encodeURIComponent(returnTo));
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
			user = verifyToken(event.cookies.get("admin_token"), event.request.headers.get("user-agent"));
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

	// ── 安全响应头（2026-09-27 安全网补强）──────────────────────────────
	// 全局下发：CSP 防 XSS 注入 / X-Frame-Options 防点击劫持 /
	// Referrer-Policy 防 referer 泄露 / nosniff 防 MIME 嗅探。
	// 注意：OAuth authorize / 管理员页若被第三方 iframe 引入会因此失效，
	// 但本系统没有对外嵌场景，DENY 是正确取舍。
	response.headers.set("X-Frame-Options", "DENY");
	response.headers.set("X-Content-Type-Options", "nosniff");
	response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

	// ── B 路 WebRTC 远控的信令源（2026-10-02）───────────────────────────
	// 集控远控页（/admin/console/remote）需要两件事，而原策略两件都拦：
	//   ① 从信令源加载 socket.io 客户端 → 需要 script-src 放行该 origin；
	//   ② 向信令源开 WebSocket            → 需要 connect-src 放行（**原策略没有 connect-src**，
	//      会回落到 default-src 'self'，于是 WS 被整个拦死 —— 这是远控在浏览器里跑不起来的根因）。
	//
	// 为什么可以放宽：信令源是**我们自己的基础设施**（公网入口经 CIMS 8096 的 `/socket.io`
	// 透传到本机边车），不是第三方 CDN。
	//
	// ⚠️ **两个 env 都没配 → 一个指令都不加**（CSP 逐字保持原样）。
	//    绝不把一个具体域名写死进安全策略 —— 换部署环境就漏。
	const p2pOrigin = (() => {
		const raw = (process.env.STELARITH_P2P_PUBLIC_URL || process.env.STELARITH_P2P_URL || "").trim();
		if (!raw) return "";
		try {
			return new URL(raw).origin; // 只取 scheme://host[:port]，丢掉路径
		} catch {
			return ""; // 非法 URL 当作"未配置"
		}
	})();
	// WebSocket 的 scheme 是 ws/wss，**不是** http(s) —— 只加 http 形态照样连不上。
	const p2pWsOrigin = p2pOrigin
		? p2pOrigin.replace(/^https:/, "wss:").replace(/^http:/, "ws:")
		: "";

	response.headers.set(
		"Content-Security-Policy",
		[
			"default-src 'self'",
			`script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net${p2pOrigin ? ` ${p2pOrigin}` : ""}`,
			"style-src 'self' 'unsafe-inline'",
			"img-src 'self' data: blob:",
			"font-src 'self' data:",
			`connect-src 'self'${p2pOrigin ? ` ${p2pOrigin} ${p2pWsOrigin}` : ""}`,
			"frame-ancestors 'none'",
			"base-uri 'self'"
		].join("; ")
	);

	// ── G1 切流量 · 第一步：旧 catch-all 打弃用标记（2026-10-02）─────────
	// 新两轴（`/api/console/control/**` 控制轴 + `/api/device/**` 被控轴）已承接全部功能，
	// 网页面板 24 处调用已全部切到新轴；**教室机仍打旧路径** —— 所以此刻**只标记、不删除**。
	// 依 RFC 9745：`Deprecation` + `Link rel="successor-version"` 指向替代轴；
	// `Sunset` 等确定删除日期再加（那一步要等教室端也切完，属 G1 收尾）。
	// 放在 hook 里而不是改 1400 行的 catch-all 文件：一处集中、加法、不与并行改动打架。
	if (event.url.pathname.startsWith("/api/console/ext/")) {
		response.headers.set("Deprecation", "true");
		response.headers.set("Link", '</api/console/control>; rel="successor-version"');
	}

	// HSTS：生产 HTTPS 强制（本地 HTTP 开发不设，否则浏览器永久记忆导致 8080 dev 无法访问）
	if (process.env.COOKIE_SECURE === "true") {
		response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
	}

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
