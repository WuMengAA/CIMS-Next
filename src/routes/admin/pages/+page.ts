import type { PageLoad } from "./$types";

// 数据在导航期并行加载（与 docs 列表同模式），悬停预取让进入列表页零等待
export const load: PageLoad = async ({ fetch }) => {
	const [fRes, dRes] = await Promise.all([fetch("/api/pages?action=folders"), fetch("/api/pages")]);
	const folders = fRes.ok ? ((await fRes.json()) as string[]) : [];
	const pages = dRes.ok ? ((await dRes.json()) as any[]) : [];
	return { folders: Array.isArray(folders) ? folders : [], pages };
};
