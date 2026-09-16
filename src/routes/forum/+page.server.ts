import { getForumChannels, getForumThreads } from "$lib/server/content-store.js";
import type { PageServerLoad } from "./$types";

export function load(): { channels: any[]; threads: any[] } {
	const channels = getForumChannels();
	const chSlug = Object.fromEntries(channels.map(c => [c.id, c.slug]));
	const threads = getForumThreads()
		.slice(0, 20)
		.map(t => ({
			id: t.id,
			channelId: t.channelId,
			channelSlug: chSlug[t.channelId] || t.channelId,
			title: t.title,
			author: t.author,
			authorRole: t.authorRole,
			createdAt: t.createdAt,
			pinned: !!t.pinned,
			views: t.views,
			lastReplyAt: t.lastReplyAt,
			excerpt: t.body
				.replace(/[#*`>\[\]()!|-]/g, "")
				.replace(/\s+/g, " ")
				.trim()
				.slice(0, 140)
		}));
	return { channels, threads };
}
