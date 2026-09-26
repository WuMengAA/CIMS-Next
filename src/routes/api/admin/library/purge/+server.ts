/** POST /api/admin/library/purge —— 强制清空某个账号的全部附件。仅 manageStorage 可用。 */
import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { userCan } from "$lib/permissions.js";
import { sessionUser } from "$lib/server/session.js";
import { adminPurgeUser } from "$lib/server/attachment-library.js";
import { recordActivity } from "$lib/server/activity.js";

export async function POST(event: RequestEvent) {
	const user = sessionUser(event);
	if (!user) return json({ error: "未登录" }, { status: 401 });
	if (!userCan(user, "manageStorage")) return json({ error: "无权操作" }, { status: 403 });

	const body = (await event.request.json().catch(() => ({}))) as { userId?: number };
	const userId = Number(body.userId);
	if (!Number.isFinite(userId) || userId <= 0) return json({ error: "用户不存在" }, { status: 400 });

	const removed = await adminPurgeUser(userId);
	recordActivity({
		userId: user.id,
		username: user.username,
		action: "other",
		target: `purge-user:${userId}`,
		detail: `清理 ${removed} 个附件`
	});
	return json({ ok: true, removed });
}
