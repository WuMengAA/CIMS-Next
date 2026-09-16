import { getForumThread, getForumChannels } from "$lib/server/content-store.js";
import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export function load({ params }: Parameters<PageServerLoad>[0]) {
	const { thread, replies } = getForumThread(params.thread);
	if (!thread || (thread.status !== "published" && thread.status !== "locked")) {
		throw error(404, "主题不存在");
	}
	const channel = getForumChannels().find(c => c.id === thread.channelId) || null;
	return { thread, replies, channel };
}
