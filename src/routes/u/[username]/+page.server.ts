import { getUserPublic, getAuthorContent } from "$lib/server/content-store.js";
import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export function load({ params }: Parameters<PageServerLoad>[0]) {
	const profile = getUserPublic(params.username);
	if (!profile) throw error(404, "用户不存在");
	const content = getAuthorContent(params.username);
	return { profile, content };
}
