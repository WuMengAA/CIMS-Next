import { listItems, toSummary } from "$lib/server/content-store.js";

export function load() {
	const docs = listItems("docs").filter(d => d.status === "published").map(toSummary);
	return { docs };
}