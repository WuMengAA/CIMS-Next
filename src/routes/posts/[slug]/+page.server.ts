import { getItem, listItems, renderMarkdown, toSummary, getSiteUrl } from "$lib/server/content-store.js";
import { error } from "@sveltejs/kit";

/**
 * 文章详情页数据。
 *
 * 与 docs/[slug] 同构：正文只以渲染后的 html 下发，`toSummary` 剥掉 body，
 * 避免把整站文章正文序列化进首屏 HTML。
 *
 * 草稿与归档一律 404：详情页是可公开访问的 URL，未发布内容不该能被 slug 直读。
 *
 * prev/next：published 文章按 date 倒序（与 /posts 列表一致），取当前的前后各一篇，
 * 供文末「上一篇 / 下一篇」用。prev=更新一篇，next=更旧一篇。
 */
export function load({ params }) {
	const post = getItem("posts", params.slug);
	if (!post || post.status !== "published") throw error(404, "文章不存在");

	const rendered = renderMarkdown(post.body);

	const sorted = listItems("posts")
		.filter((p) => p.status === "published")
		.slice()
		.sort((a, b) => String(b.date).localeCompare(String(a.date)));
	const idx = sorted.findIndex((p) => p.slug === params.slug);
	const pick = (p: any) => (p ? { slug: p.slug, title: p.title, date: p.date } : null);
	const prev = idx > 0 ? pick(sorted[idx - 1]) : null;
	const next = idx >= 0 && idx < sorted.length - 1 ? pick(sorted[idx + 1]) : null;

	return {
		post: toSummary(post),
		html: rendered.html,
		words: rendered.words,
		prev,
		next,
		// 供页面拼 JSON-LD 的绝对地址；Seo 组件的 canonical 自己会拼，这里只给结构化数据用
		siteUrl: getSiteUrl()
	};
}
