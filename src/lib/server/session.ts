/**
 * 会话用户解析的统一入口。
 *
 * 之前每个 API 路由都自己抄一遍「读 cookie → verifyToken → getUser」，问题不只是重复：
 * 那份重复代码返回的是 `User`，其 `id` 是可选字段（历史 JSON 时代留下的），
 * 于是每个调用点都要跟 `number | undefined` 搏斗一次。
 *
 * 这里一次性把它收窄成 `SessionUser`（id 必有）：
 * 拿不到主键的账号无法参与任何按 owner_id 隔离的查询，所以那种情况按未登录处理，
 * 而不是让它在下游以 undefined 的身份继续跑——那才是真正危险的分支。
 */
import type { RequestEvent } from "@sveltejs/kit";
import { verifyToken, getUser, type User } from "./auth.js";

export interface SessionUser extends User {
	/** 数据库主键，必有值。 */
	id: number;
}

/**
 * 从请求里解析登录用户。
 * @param event 只要有 cookies 即可（页面 load 与 API 端点都能传）。
 */
export async function sessionUser(event: Pick<RequestEvent, "cookies">): Promise<SessionUser | null> {
	const token = event.cookies.get("admin_token");
	if (!token) return null;
	const u = await verifyToken(token);
	if (!u) return null;
	// verifyToken 返回的是登录时刻的快照，再读一次拿最新的资料与主键。
	const fresh = await getUser((await u).username) ?? u;
	return (await fresh).id ? (await fresh as SessionUser) : null;
}

/** 401 的中文响应，省得每个路由各写一遍。 */
export function unauthorized() {
	return new Response(JSON.stringify({ error: "未登录" }), {
		status: 401,
		headers: { "content-type": "application/json" }
	});
}
