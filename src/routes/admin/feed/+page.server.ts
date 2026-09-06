import { getFeedConfig, getSiteUrl } from "$lib/server/content-store.js";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = () => ({
	config: getFeedConfig(),
	siteUrl: getSiteUrl()
});
