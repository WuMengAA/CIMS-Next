import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getClassIslandAnnouncements } from "$lib/server/rss.js";
import { getSiteUrl } from "$lib/server/content-store.js";

// ClassIsland「Web 公告」提供方拉取的端点（公开，无需鉴权）。
// 在 ClassIsland → 设置 → 通知 → Web 公告源 中填入： <本站地址>/api/classisland/announcements
// ?refresh=1 可强制重新聚合新闻（绕过缓存）。
export const GET: RequestHandler = async ({ url }) => {
	const force = url.searchParams.get("refresh") === "1";
	const data = await getClassIslandAnnouncements(getSiteUrl(url.origin), force);
	return json(data, {
		headers: {
			"Cache-Control": "public, max-age=300",
			"Access-Control-Allow-Origin": "*"
		}
	});
};
