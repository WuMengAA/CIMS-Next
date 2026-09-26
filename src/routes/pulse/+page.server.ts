/**
 * /pulse —— 站点活跃度。
 *
 * 刻意做成公开页：站点活跃度本来就是给外人看的招牌，登录墙挡不住的意义。
 * 但**在线名单只公开用户名与头像**，不暴露 IP、会话数与邮箱——
 * "谁在线"和"谁上周活跃"是两回事，别混在一起。
 */
import type { PageServerLoad } from "./$types";
import { verifyToken, getUser } from "$lib/server/auth.js";
import { userCan } from "$lib/permissions.js";
import {
	onlineUsers,
	activitySummary,
	listActivities,
	dailyActivities,
	topActiveUsers,
	ONLINE_WINDOW_MS
} from "$lib/server/activity.js";
import { adminUsageOverview } from "$lib/server/attachment-library.js";

export const load: PageServerLoad = ({ cookies }) => {
	const u = verifyToken(cookies.get("admin_token"));
	const admin = u ? getUser(u.username) : null;
	const canSeeStorage = !!admin && userCan(admin, "manageStorage");

	const online = onlineUsers().map((o) => ({
		username: o.username,
		displayName: o.displayName || o.username,
		role: o.role,
		avatar: o.avatar || ""
	}));

	return {
		online,
		onlineWindowMin: Math.round(ONLINE_WINDOW_MS / 60000),
		summary: activitySummary(),
		feed: listActivities({ limit: 40 }).items.map((a) => ({
			id: a.id,
			username: a.username,
			action: a.action,
			target: a.target,
			detail: a.detail,
			createdAt: a.created_at
		})),
		// 月度热度：最近 30 天，按天
		heat: dailyActivities(30),
		top: topActiveUsers(14, 8),
		storage: canSeeStorage
			? adminUsageOverview().map((r) => ({
					username: r.username,
					displayName: r.displayName,
					usedBytes: r.usedBytes,
					quotaBytes: r.quotaBytes,
					files: r.files
				}))
			: null
	};
};
