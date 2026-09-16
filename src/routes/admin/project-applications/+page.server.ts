import { getProjectApplications } from "$lib/server/content-store.js";
import type { PageServerLoad } from "./$types";

export function load() {
	return { apps: getProjectApplications() };
}
