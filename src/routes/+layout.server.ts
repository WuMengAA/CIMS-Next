import { getSettings, getNav, getSiteUrl } from "$lib/server/content-store.js";
import { verifyToken, sanitizeAvatar } from "$lib/server/auth.js";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ cookies }) => {
	const token = cookies.get("admin_token");
	const user = await verifyToken(token);
	return {
		settings: getSettings(),
		nav: getNav(),
		siteUrl: getSiteUrl(),
		// 登录态在服务端同步判定并随根 layout 数据下发，避免客户端再发请求造成侧边栏闪烁。
		// 客户端 SPA 导航时根 layout 的 load 会被 SvelteKit 缓存，user 保持稳定。
		user: user
			? {
					username: (await user).username,
					role: (await user).role,
					displayName: (user as any).displayName || (await user).username,
					// avatar 必须经 sanitizeAvatar 规整：DB 存在历史脏值（如 "admin" 裸文件名），
					// 直接下发到 <img src> 会在后台任意路由（如 /admin/console）下被解析成
					// "/admin/admin" 并 404。脏值归空串后 UI 回落默认头像。
					avatar: sanitizeAvatar((user as any).avatar)
				}
			: null,
		// 是否有编辑权限（admin / editor 可进后台改内容；普通读者/未登录为 false）。
		// 前端所有“编辑/创建”入口与后台菜单都按它显隐，配合 hooks.server.ts 的服务端角色校验。
		canEdit: !!user && ((await user).role === "admin" || (await user).role === "editor")
	};
};
