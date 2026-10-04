import { getItem, renderMarkdown } from "$lib/server/content-store.js";
import { getBoard, listIssues, issueStats } from "$lib/server/project-board.js";
import { hasGithubToken } from "$lib/server/github.js";
import { error } from "@sveltejs/kit";

export function load({ params }) {
	const project = getItem("projects", params.slug);
	if (!project) throw error(404, "项目不存在");
	const rendered = renderMarkdown(project.body);

	// 展板是可选增强：没配置展板的项目仍能正常浏览正文，只是不显示活跃度/发行/进度。
	const board = getBoard(params.slug);

	// Issues 与展板解耦：任何项目页都应有「反馈 / 提 issue」入口（对齐 GitHub 每个仓库都有 Issues 标签）。
	// 展板只决定「活跃度 / 进度待办 / 发行下载」这三块是否出现。
	return {
		project,
		html: rendered.html,
		words: rendered.words,
		board,
		issues: listIssues(params.slug, { state: "all" }),
		stats: issueStats(params.slug),
		hasGithubToken: hasGithubToken()
	};
}
