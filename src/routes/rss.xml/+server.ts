import type { RequestHandler } from "./$types";
import { getBlogRssItems, buildRss } from "$lib/server/rss.js";
import { getSettings, getSiteUrl } from "$lib/server/content-store.js";

// 站点博客 RSS 2.0 订阅源。支持 ?author=username 生成单作者订阅源。
export const GET: RequestHandler = ({ url }) => {
	const origin = getSiteUrl(url.origin);
	const author = url.searchParams.get("author") || undefined;
	const settings = getSettings();
	const title = settings.title + (author ? " · " + author : "") + " · 博客";
	const items = getBlogRssItems(origin, author);
	const xml = buildRss({
		title,
		link: origin + "/posts",
		description: settings.description || "Stelarith 博客文章订阅源",
		items,
		selfUrl: origin + "/rss.xml" + (author ? "?author=" + encodeURIComponent(author) : "")
	});
	return new Response(xml, {
		headers: {
			"Content-Type": "application/rss+xml; charset=utf-8",
			"Cache-Control": "public, max-age=600"
		}
	});
};
