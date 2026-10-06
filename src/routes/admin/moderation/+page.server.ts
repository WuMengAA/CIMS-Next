/**
 * /admin/moderation —— 审核中心（2026-10-06 合并单界面）。
 *
 * 把原先 8 个分散审核入口（评论/反馈/论坛/友链/项目专页/文档纠错/权限申请）
 * 收敛成一个页面：顶部 tab 切换，内嵌对应原路由（同源 iframe，带登录态）。
 * 原路由保留（兼容旧链接），侧栏只留「审核中心」一个入口。
 *
 * 权限：进入需 moderate（L3 审核员）；权限申请 tab 额外要求 reviewPermission，
 * 无该权限的角色看不到/点不开那个 tab（与后台门槛同源）。
 */
import { userCan } from "$lib/permissions.js";
import { verifyToken } from "$lib/server/auth.js";
import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ cookies, url }) => {
	const t = cookies.get("admin_token") ?? "";
	const u = t ? verifyToken(t) : null;
	if (!u || !userCan(u, "moderate")) throw redirect(303, "/admin/login");

	// 权限申请门槛独立（reviewPermission L5）—— 不满足就不给 tab，避免点了必失败。
	const canReviewRoles = userCan(u, "reviewPermission");

	return {
		user: u,
		canReviewRoles,
		tab: (url.searchParams.get("tab") || "").slice(0, 40)
	};
};
