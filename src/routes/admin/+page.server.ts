import { verifyToken } from "$lib/server/auth.js";
import type { PageServerLoad } from "./$types";

/**
 * 后台仪表盘需要知道当前账号的角色，才能按能力显隐统计卡与快速操作。
 *
 * 注意 role 的来路：不直接信任客户端传参，而是在服务端从 cookie 里的会话令牌
 * 重新解出 —— 与 hooks.server.ts 的守卫同一来源，客户端无法伪造。
 */
export const load: PageServerLoad = async ({ cookies }) => {
	const u = verifyToken(cookies.get("admin_token") ?? "");
	return {
		user: u ? { username: u.username, role: u.role, displayName: u.displayName } : null
	};
};
