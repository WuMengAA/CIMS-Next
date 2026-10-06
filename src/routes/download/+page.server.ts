/**
 * /download —— 官网下载中心：统一资源整合面板。
 *
 * 数据源：`/api/download`（服务端聚合项目发行包 + 上传资源），页面只负责
 * 搜索框 + 分类标签 + 结果列表。
 *
 * 2026-10-06 改版：被控端/管理端装机卡片**已迁移至项目页**（/projects/xingjikong，
 * 版本实时取云端 ota）—— 下载中心只做「全部资源」的搜索与展示，不再承担装机引导。
 */

import type { PageServerLoad } from "./$types";

/** 资源分类（与 /api/download 的 types 对齐）。 */
const TYPES: { key: string; label: string }[] = [
	{ key: "project", label: "项目发行" },
	{ key: "image", label: "图片" },
	{ key: "video", label: "视频" },
	{ key: "doc", label: "文档" },
	{ key: "app", label: "应用" }
];

/** 从公开下载端点拉全量（服务端聚合，避免浏览器直连云端）。 */
async function fetchAll(): Promise<{ id: string; type: string; title: string; desc: string; url: string; size: number; date: string; sizeText: string }[]> {
	const base = process.env.SITE_ORIGIN || "http://127.0.0.1:8090";
	try {
		const res = await fetch(`${base}/api/download`, { signal: AbortSignal.timeout(5000) });
		if (!res.ok) return [];
		const j = (await res.json()) as { ok?: boolean; items?: unknown[] };
		return Array.isArray(j.items) ? (j.items as never[]) : [];
	} catch {
		return [];
	}
}

export const load: PageServerLoad = async ({ url }) => {
	const q = (url.searchParams.get("q") || "").slice(0, 60);
	const rawType = url.searchParams.get("type") || "";
	const type = TYPES.some((t) => t.key === rawType) ? rawType : "";

	const allItems = await fetchAll();

	// 客户端继续过滤（q / type 变化不重新拉全量；数据量小，一次拉齐更顺滑）
	return {
		allItems,
		types: TYPES,
		initialQ: q,
		initialType: type
	};
};
