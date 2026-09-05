import { getSettings, getNav } from "$lib/server/content-store.js";

export function load() {
	return { settings: getSettings(), nav: getNav() };
}