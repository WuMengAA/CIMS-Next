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
	// 博客停更后 RSS 里一条都没有，还硬报 feed 会让人以为漏订阅了。
	// 空源直接 404，搜索引擎与阅读器都不会把它当"站点在更新"的信号。
	if (!items.length) return new Response("No posts", { status: 404 });
	const xml = buildRss({
		title,
		link: origin + "/changelog",
		description: settings.description || "Stelarith 站点动态订阅源",
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
