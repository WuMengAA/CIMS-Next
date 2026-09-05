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
		user: user ? { username: user.username, role: user.role } : null
	};
};
