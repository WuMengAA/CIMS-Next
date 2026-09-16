import { getLinks } from "$lib/server/content-store.js";

export function load() {
	return { links: getLinks() };
}