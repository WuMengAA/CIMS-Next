import { listItems, toSummary } from "$lib/server/content-store.js";

export function load() {
	const projects = listItems("projects").filter(p => p.status === "published").map(toSummary);
	return { projects };
}