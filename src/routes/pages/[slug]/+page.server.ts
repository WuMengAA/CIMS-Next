import { getItem, renderMarkdown, toSummary } from "$lib/server/content-store.js";
import { error } from "@sveltejs/kit";

export function load({ params }: { params: { slug: string } }) {
	const page = getItem("pages", params.slug);
	if (!page) throw error(404, "页面不存在");
	const rendered = renderMarkdown(page.body);
	return { page: toSummary(page), html: rendered.html, toc: rendered.toc, words: rendered.words };
}
