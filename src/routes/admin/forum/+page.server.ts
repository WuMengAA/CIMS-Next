import { getForumThreads, getForumChannels } from "$lib/server/content-store.js";
import type { PageServerLoad } from "./$types";

export function load(): { threads: any[]; channels: any[] } {
	const threads = getForumThreads(undefined, true).map(t => ({
		id: t.id,
		channelId: t.channelId,
		title: t.title,
		author: t.author,
		status: t.status,
		pinned: !!t.pinned,
		createdAt: t.createdAt
	}));
	const channels = getForumChannels();
	return { threads, channels };
}
