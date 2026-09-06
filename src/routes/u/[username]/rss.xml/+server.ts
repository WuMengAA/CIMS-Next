import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getBlogRssItems, buildRss } from "$lib/server/rss.js";
import { getSettings, getUserPublic, getSiteUrl } from "$lib/server/content-store.js";

// 单作者博客 RSS 订阅源：/u/<username>/rss.xml
export const GET: RequestHandler = ({ url, params }) => {
	const username = params.username;
	const user = getUserPublic(username);
	if (!user) throw error(404, "用户不存在");
	const origin = getSiteUrl(url.origin);
	const settings = getSettings();
	const display = user.displayName || username;
	const items = getBlogRssItems(origin, username);
	const xml = buildRss({
		title: settings.title + " · " + display + " 的博客",
		link: origin + "/u/" + username,
		description: (user.bio || display + " 的个人博客订阅源"),
		items,
		selfUrl: origin + "/u/" + username + "/rss.xml"
	});
	return new Response(xml, {
		headers: {
			"Content-Type": "application/rss+xml; charset=utf-8",
			"Cache-Control": "public, max-age=600"
		}
	});
};
