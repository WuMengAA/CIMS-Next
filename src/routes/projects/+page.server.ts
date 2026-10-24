import { listItems, toSummary } from "$lib/server/content-store.js";
import { getBoards, summarizeBoard, mergedContrib } from "$lib/server/project-board.js";
import { hasGithubToken } from "$lib/server/github.js";

export async function load() {
	const projects = listItems("projects").filter((p) => p.status === "published").map(toSummary);

	// 展板数据与内容项按 slug 对齐：内容项是「有哪些项目」，展板是「项目做到哪了」。
	// 两者解耦存放（content/projects/*.md 与 content/project-boards.json），
	// 因此这里做一次显式 join，缺展板的项目会拿到 hasBoard=false 而不是报错。
	const boards = getBoards();
	const bySlug = new Map(boards.map((b) => [b.slug, b]));

	const summaries = await Promise.all(
		projects.map(async (p) => await summarizeBoard(p as any, bySlug.get(String(p.slug)) ?? null))
	);
	const contrib = mergedContrib(boards);

	const perProject: Record<string, Record<string, number>> = {};
	for (const b of boards) perProject[b.slug] = b.contrib ?? {};

	return {
		projects,
		summaries,
		contrib,
		perProject,
		hasBoardData: summaries.some((s) => s.hasBoard),
		hasGithubToken: hasGithubToken()
	};
}
