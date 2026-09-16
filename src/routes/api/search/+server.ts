import { json } from "@sveltejs/kit";
import { searchContent } from "$lib/server/search.js";
import type { SearchSection } from "$lib/server/search.js";
import type { RequestHandler } from "./$types";

const VALID: SearchSection[] = ["posts", "projects", "docs", "pages"];

/**
 * GET /api/search?q=关键词&section=posts,projects&limit=40
 *
 * 公开接口（无需登录）。空查询返回空结果而不是报错，便于前端在输入框清空时直接消费。
 */
export const GET: RequestHandler = async ({ url }) => {
	const q = url.searchParams.get("q") || "";
	const limitParam = Number(url.searchParams.get("limit"));
	const sectionParam = url.searchParams.get("section");

	const sections = sectionParam
		? (sectionParam
				.split(",")
				.map(s => s.trim())
				.filter(s => (VALID as string[]).includes(s)) as SearchSection[])
		: undefined;

	const result = searchContent(q, {
		sections: sections && sections.length ? sections : undefined,
		limit: Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 40
	});

	return json(result, {
		headers: {
			// 搜索结果依赖内容快照，允许短暂缓存以减少重复扫描
			"Cache-Control": "public, max-age=30, stale-while-revalidate=300"
		}
	});
};
