import { listItems, getItem, renderMarkdown } from "$lib/server/content-store.js";
import { error } from "@sveltejs/kit";

export function load({ params }) {
	const doc = getItem("docs", params.slug);
	if (!doc) throw error(404, "文档不存在");
	const rendered = renderMarkdown(doc.body);
	const allDocs = listItems("docs").filter(d => d.status === "published");
	return { doc, html: rendered.html, toc: rendered.toc, words: rendered.words, allDocs };
}