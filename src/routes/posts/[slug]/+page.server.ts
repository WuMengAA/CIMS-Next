import { getItem, renderMarkdown, toSummary, getSiteUrl } from "$lib/server/content-store.js";
import { error } from "@sveltejs/kit";

/**
 * 文章详情页数据。
 *
 * 与 docs/[slug] 同构：正文只以渲染后的 html 下发，`toSummary` 剥掉 body，
 * 避免把整站文章正文序列化进首屏 HTML。
 *
 * 草稿与归档一律 404：详情页是可公开访问的 URL，未发布内容不该能被 slug 直读。
 */
export function load({ params }) {
	const post = getItem("posts", params.slug);
	if (!post || post.status !== "published") throw error(404, "文章不存在");

	const rendered = renderMarkdown(post.body);
	return {
		post: toSummary(post),
		html: rendered.html,
		words: rendered.words,
		// 供页面拼 JSON-LD 的绝对地址；Seo 组件的 canonical 自己会拼，这里只给结构化数据用
		siteUrl: getSiteUrl()
	};
}
