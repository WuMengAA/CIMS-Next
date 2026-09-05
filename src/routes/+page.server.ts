import { listItems } from "$lib/server/content-store.js";

export function load() {
	const posts = listItems("posts").filter(p => p.status === "published").slice(0, 4);
	const projects = listItems("projects").filter(p => p.status === "published").slice(0, 3);
	const docs = listItems("docs").filter(d => d.status === "published").slice(0, 3);
	return { posts, projects, docs };
}