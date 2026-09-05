import { listItems, getCategories } from "$lib/server/content-store.js";

function countWords(body: string): number {
	return body.replace(/[#*`\[\]()!>\-\s]/g, "").length;
}

export function load() {
	const posts = listItems("posts")
		.filter(p => p.status === "published")
		.map(p => ({ ...p, words: countWords(p.body || "") }));
	const categories = ["全部", ...getCategories("posts")];
	return { posts, categories };
}