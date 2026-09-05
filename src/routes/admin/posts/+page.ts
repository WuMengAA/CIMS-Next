import type { PageLoad } from "./$types";

// 数据在导航期并行加载（而非挂载后再 fetch），配合 data-sveltekit-preload-data
// 悬停预取，点击进入列表页时数据基本已就绪。
export const load: PageLoad = async ({ fetch }) => {
	const res = await fetch("/api/posts");
	return { posts: res.ok ? ((await res.json()) as any[]) : [] };
};
