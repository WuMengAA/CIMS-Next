import type { PageServerLoad } from "./$types";
import { listActivities, onlineUsers, activitySummary } from "$lib/server/activity.js";

/**
 * 活动中心首屏数据（服务端直出）。
 * 进入本页需 viewAdmin 权限，由 hooks.server.ts 统一把关。
 */
export const load: PageServerLoad = () => {
	const { items, total } = listActivities({ limit: 60 });
	return {
		items,
		total,
		summary: activitySummary(),
		online: onlineUsers()
	};
};
