import { listItems, getCategories, toSummary } from "$lib/server/content-store.js";

function countWords(body: string): number {
	return body.replace(/[#*`\[\]()!>\-\s]/g, "").length;
}

export function load() {
	const posts = listItems("posts")
		.filter(p => p.status === "published")
		// 先算字数再转摘要：列表不需要正文，避免 SSR 内联整站内容
		.map(p => ({ ...toSummary(p), words: countWords(p.body || "") }));
	const categories = ["全部", ...getCategories("posts")];
	return { posts, categories };
}