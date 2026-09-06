import { listItems, getItem, renderMarkdown, toSummary } from "$lib/server/content-store.js";
import { error } from "@sveltejs/kit";

export function load({ params }) {
	const doc = getItem("docs", params.slug);
	if (!doc) throw error(404, "文档不存在");
	const rendered = renderMarkdown(doc.body);
	// 正文只以渲染后的 html 下发；doc 与 allDocs 一律剥离 body，
	// 否则每个详情页都会把整站文档正文序列化进 HTML
	const allDocs = listItems("docs").filter(d => d.status === "published").map(toSummary);
	return { doc: toSummary(doc), html: rendered.html, toc: rendered.toc, words: rendered.words, allDocs };
}