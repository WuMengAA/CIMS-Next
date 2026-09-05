import { getItem, renderMarkdown, listItems } from "$lib/server/content-store.js";
import { error } from "@sveltejs/kit";

export function load({ params }) {
	const post = getItem("posts", params.slug);
	if (!post) throw error(404, "文章不存在");
	const rendered = renderMarkdown(post.body);

	// Find prev/next by date order
	const all = listItems("posts").filter(p => p.status === "published");
	const idx = all.findIndex(p => p.slug === params.slug);
	const prev = idx > 0 ? all[idx - 1] : null;
	const next = idx >= 0 && idx < all.length - 1 ? all[idx + 1] : null;

	return {
		post,
		html: rendered.html,
		toc: rendered.toc,
		words: rendered.words,
		prev,
		next
	};
}