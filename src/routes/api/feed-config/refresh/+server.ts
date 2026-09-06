import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getAggregatedNews } from "$lib/server/rss.js";
import { getApiUser } from "$lib/server/api-auth.js";
import { can } from "$lib/permissions.js";

// 后台「立即刷新聚合缓存」：强制重新抓取所有启用源并写缓存（需 manageSettings）。
export const POST: RequestHandler = async ({ request }) => {
	const user = getApiUser(request);
	if (!user || !can(user.role, "manageSettings")) return json({ error: "无权限" }, { status: 403 });
	const items = await getAggregatedNews(true);
	return json({ ok: true, count: items.length });
};
