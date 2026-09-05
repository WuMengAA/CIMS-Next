import type { PageLoad } from "./$types";

// 数据在导航期并行加载（与 posts 列表同模式）
export const load: PageLoad = async ({ fetch }) => {
	const res = await fetch("/api/projects");
	return { projects: res.ok ? ((await res.json()) as any[]) : [] };
};
