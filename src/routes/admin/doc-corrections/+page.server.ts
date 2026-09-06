import { getDocCorrections } from "$lib/server/content-store.js";
import type { PageServerLoad } from "./$types";

export function load() {
	return { corrections: getDocCorrections() };
}
