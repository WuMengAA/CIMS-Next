/**
 * 前台 / 后台切换的**唯一**判定与来路记忆（前后台通用，纯逻辑、无 server-only 依赖）。
 *
 * 为什么要有这个文件：同一个「能不能进后台」「回来之前我在前台哪一页」的问题，
 * 原先散在侧栏滑块、侧栏菜单项、后台顶栏三处各写一套判断，长期必然漂移
 * （实测会出现「有滑块但没有后台菜单项」这种错配）。集中在这里，
 * 所有入口都调同一份实现，之后只会一起变。
 */
import { userCan, type Role, type TitleKey } from "$lib/permissions.js";

/** 判定所需的最小用户信息（根布局 data.user 的子集）。 */
export type SwitchUser = { role?: Role | null; titles?: TitleKey[] | null } | null | undefined;

/**
 * 「能进后台」的唯一判定 —— 返回该用户进后台的落点；不能进返回 null，
 * 调用方据此**完全不渲染**入口（而不是渲染一个灰的、点了被弹回登录页的死入口）。
 *
 * 落点规则（回归底线，别改）：能进 /admin 就进 /admin；只有集控权限的人
 * （电教委员等）直接进 /admin/console —— 送他去 /admin 会被 hooks 弹回来，
 * 用户会以为「登录没生效」，于是反复登录。
 */
export function adminEntryHref(user: SwitchUser): string | null {
	if (!user) return null;
	if (userCan(user, "viewAdmin")) return "/admin";
	if (userCan(user, "viewConsole")) return "/admin/console";
	return null;
}

/** 「上次在前台看的那一页」在 sessionStorage 里的键（带 stelarith: 前缀，避免与第三方脚本撞名）。 */
export const LAST_SITE_PATH_KEY = "stelarith:last-site-path";

/**
 * 把任意字符串收敛成一个可安全用作 href 的站内路径；不合规一律回落到首页 "/"。
 * 与 safeReturnTo 同一套白名单思路：只认站内相对路径，拒绝协议/域名/反斜杠/换行。
 *
 * 边界（任务卡 A1 明列，不做就是 bug）：
 *  - 空 → "/"
 *  - 以 /admin 开头（含 /admin/login）→ "/"（后台路径不能当「前台来路」，
 *    否则在后台点「前台」会回到后台自己）
 */
export function siteHrefFrom(raw: string | null | undefined): string {
	const p = (raw ?? "").trim();
	if (!p.startsWith("/") || p.startsWith("//")) return "/";
	if (p.includes("://") || p.includes("\\") || /[\r\n]/.test(p)) return "/";
	if (p === "/admin" || p.startsWith("/admin/") || p.startsWith("/admin?") || p.startsWith("/admin#")) return "/";
	return p;
}

/** 记下「不是 /admin 开头的最后访问路径」（含查询串），供后台的「前台」按钮回跳。 */
export function rememberLastSitePath(pathname: string, search = ""): void {
	if (!pathname || pathname.startsWith("/admin")) return;
	try {
		sessionStorage.setItem(LAST_SITE_PATH_KEY, pathname + (search || ""));
	} catch {
		/* 无痕模式等禁用 sessionStorage 时静默降级：入口仍可用，只是回首页 */
	}
}

/** 读取上次的前台路径；没有 / 不可用 / 不合规一律返回 "/"。SSR 期没有 sessionStorage，同样回 "/"。 */
export function readLastSitePath(): string {
	let raw = "";
	try {
		raw = sessionStorage.getItem(LAST_SITE_PATH_KEY) ?? "";
	} catch {
		return "/";
	}
	return siteHrefFrom(raw);
}

/**
 * 校验登录回跳目标 `returnTo`，**只接受站内路径**，否则返回 null（调用方退回 /admin）。
 *
 * 🔴 这是开放重定向的唯一防线：绝不能把查询串里的字符串直接塞进跳转地址，
 * 否则攻击者发一条 /admin/login?returnTo=https://evil.com 就能把刚登录的老师带去钓鱼站
 * （用户信任的是本站域名，落点却在别处）。
 *
 * 逐条挡掉的输入：
 *  1. 不以单个 "/" 开头（`https://evil.com`、`javascript:alert(1)`、`mailto:x@y`）→ 丢弃
 *  2. 第二个字符是 "/" 或 "\"（`//evil.com`、`/\evil.com`）→ 丢弃
 *     （浏览器把二者都当协议相对地址，会跳到站外）
 *  3. 含 "://"（`/a?u=https://evil.com` 之外的 `/https://evil.com` 之类伪装）→ 丢弃
 *  4. 含反斜杠 "\"（`/\/\/evil.com`；Windows 上的浏览器常把 \ 归一成 /）→ 丢弃
 *  5. 含换行 CR/LF（`/admin\nLocation: https://evil.com` 式的响应头/参数截断）→ 丢弃
 */
export function safeReturnTo(raw: string | null | undefined): string | null {
	const p = (raw ?? "").trim();
	if (!p.startsWith("/")) return null;
	if (p.length > 1 && (p[1] === "/" || p[1] === "\\")) return null;
	if (p.includes("://")) return null;
	if (p.includes("\\")) return null;
	if (/[\r\n]/.test(p)) return null;
	return p;
}
