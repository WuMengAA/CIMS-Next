import { listItems, toSummary } from "$lib/server/content-store.js";

export function load() {
	// 只取摘要（不含正文），避免把整站正文序列化进 SSR HTML
	const posts = listItems("posts").filter(p => p.status === "published").slice(0, 4).map(toSummary);
	const projects = listItems("projects").filter(p => p.status === "published").slice(0, 3).map(toSummary);
	const docs = listItems("docs").filter(d => d.status === "published").slice(0, 3).map(toSummary);
	return { posts, projects, docs };
}