import { getComments } from "$lib/server/content-store.js";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = () => ({
	comments: getComments()
});
