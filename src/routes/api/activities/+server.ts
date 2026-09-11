import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { listActivities, onlineUsers, activitySummary } from "$lib/server/activity.js";
import { can } from "$lib/permissions.js";

/**
 * GET /api/activities
 * 多用户活动流。需具备后台查看权限（viewAdmin / moderate / manageUsers）。
 * 查询参数：limit / offset / username / action / since
 */
export function GET(event: RequestEvent) {
	const { url, cookies } = event;
	const user = verifyToken(cookies.get("admin_token"));
	if (!user) return json({ error: "未登录" }, { status: 401 });
	if (!(can(user.role, "viewAdmin") || can(user.role, "moderate"))) {
		return json({ error: "无权限" }, { status: 403 });
	}

	const q = url.searchParams;
	const { items, total } = listActivities({
		limit: Number(q.get("limit") || 60),
		offset: Number(q.get("offset") || 0),
		username: q.get("username") || undefined,
		action: q.get("action") || undefined,
		since: q.get("since") || undefined
	});

	return json({
		items,
		total,
		summary: activitySummary(),
		online: onlineUsers()
	});
}
