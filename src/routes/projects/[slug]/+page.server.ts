import { getItem, renderMarkdown } from "$lib/server/content-store.js";
import { error } from "@sveltejs/kit";

export function load({ params }) {
	const project = getItem("projects", params.slug);
	if (!project) throw error(404, "项目不存在");
	const rendered = renderMarkdown(project.body);
	return { project, html: rendered.html, words: rendered.words };
}