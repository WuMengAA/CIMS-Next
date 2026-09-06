import { getAnnouncements } from "$lib/server/content-store.js";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = () => ({
	announcements: getAnnouncements({ activeOnly: true })
});
