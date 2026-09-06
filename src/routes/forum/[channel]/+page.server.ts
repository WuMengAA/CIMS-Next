import { getForumChannel, getForumThreads } from "$lib/server/content-store.js";
import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export function load({ params }: Parameters<PageServerLoad>[0]) {
	const channel = getForumChannel(params.channel);
	if (!channel) throw error(404, "频道不存在");
	const threads = getForumThreads(channel.id).map(t => ({
		id: t.id,
		title: t.title,
		author: t.author,
		authorRole: t.authorRole,
		createdAt: t.createdAt,
		pinned: !!t.pinned,
		views: t.views,
		status: t.status,
		lastReplyAt: t.lastReplyAt,
		excerpt: t.body.replace(/[#*`>\[\]()!|-]/g, "").replace(/\s+/g, " ").trim().slice(0, 160)
	}));
	return { channel, threads };
}
