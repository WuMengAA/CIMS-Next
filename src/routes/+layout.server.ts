import { getSettings, getNav } from "$lib/server/content-store.js";
import { verifyToken } from "$lib/server/auth.js";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = ({ cookies }) => {
	const token = cookies.get("admin_token");
	const user = verifyToken(token);
	return {
		settings: getSettings(),
		nav: getNav(),
		// 登录态在服务端同步判定并随根 layout 数据下发，避免客户端再发请求造成侧边栏闪烁。
		// 客户端 SPA 导航时根 layout 的 load 会被 SvelteKit 缓存，user 保持稳定。
		user: user ? { username: user.username, role: user.role } : null,
		// 是否有编辑权限（admin / editor 可进后台改内容；普通读者/未登录为 false）。
		// 前端所有“编辑/创建”入口与后台菜单都按它显隐，配合 hooks.server.ts 的服务端角色校验。
		canEdit: !!user && (user.role === "admin" || user.role === "editor")
	};
};
