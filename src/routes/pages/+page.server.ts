import { listItems, toSummary } from "$lib/server/content-store.js";

export function load() {
	const pages = listItems("pages").filter((d) => d.status === "published").map(toSummary);
	return { pages };
}
