import { getItem, renderMarkdown, listItems, toSummary } from "$lib/server/content-store.js";
import { error } from "@sveltejs/kit";

export function load({ params }) {
	const post = getItem("posts", params.slug);
	if (!post) throw error(404, "文章不存在");
	const rendered = renderMarkdown(post.body);

	// Find prev/next by date order
	const all = listItems("posts").filter(p => p.status === "published");
	const idx = all.findIndex(p => p.slug === params.slug);
	// 上下篇只需要元数据；正文只以渲染后的 html 下发，避免内联整站内容
	const prev = idx > 0 ? toSummary(all[idx - 1]) : null;
	const next = idx >= 0 && idx < all.length - 1 ? toSummary(all[idx + 1]) : null;

	return {
		post: toSummary(post),
		html: rendered.html,
		toc: rendered.toc,
		words: rendered.words,
		prev,
		next
	};
}