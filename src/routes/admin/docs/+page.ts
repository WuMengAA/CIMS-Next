import type { PageLoad } from "./$types";

// 数据在导航期并行加载（与 posts 列表同模式），悬停预取让进入列表页零等待
export const load: PageLoad = async ({ fetch }) => {
	const [fRes, dRes] = await Promise.all([fetch("/api/docs?action=folders"), fetch("/api/docs")]);
	const folders = fRes.ok ? ((await fRes.json()) as string[]) : [];
	const docs = dRes.ok ? ((await dRes.json()) as any[]) : [];
	return { folders: Array.isArray(folders) ? folders : [], docs };
};
