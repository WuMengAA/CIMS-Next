import type { PageLoad } from "./$types";

/**
 * 展板管理页的数据在导航期并行拉取（与 /admin/projects 同模式）：
 * - /api/projects   → 有哪些项目（内容项）
 * - /api/project-board → 这些项目的展板配置（仓库绑定 / 待办 / 发行 / 同步缓存）
 *
 * 两者在前端按 slug 对齐 —— 与前台一致，缺展板的项目也能出现在列表里（表现为「未配置」）。
 */
export const load: PageLoad = async ({ fetch }) => {
	const [pRes, bRes] = await Promise.all([fetch("/api/projects"), fetch("/api/project-board")]);
	const projects = pRes.ok ? ((await pRes.json()) as any[]) : [];
	const bj = bRes.ok ? await bRes.json() : { boards: [], github: { hasToken: false } };
	return {
		projects,
		boards: (bj.boards ?? []) as any[],
		github: (bj.github ?? { hasToken: false }) as { hasToken: boolean }
	};
};
