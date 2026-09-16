import { searchContent, SECTION_META } from "$lib/server/search.js";
import type { SearchSection } from "$lib/server/search.js";
import { listItems } from "$lib/server/content-store.js";

const VALID: SearchSection[] = ["posts", "projects", "docs", "pages"];

/** 收集全站热门标签/分类，作为「没有查询时」的推荐入口。 */
function collectSuggestions(): string[] {
	const counter = new Map<string, number>();
	for (const section of VALID) {
		for (const item of listItems(section)) {
			if (item.status !== "published") continue;
			const cat = (item.category as string) || "";
			if (cat) counter.set(cat, (counter.get(cat) || 0) + 2);
			for (const t of (Array.isArray(item.tags) ? (item.tags as string[]) : [])) {
				counter.set(t, (counter.get(t) || 0) + 1);
			}
		}
	}
	return [...counter.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, 12)
		.map(([k]) => k);
}

export function load({ url }: { url: URL }) {
	const q = (url.searchParams.get("q") || "").slice(0, 120);
	const rawSection = url.searchParams.get("section") || "";
	const sections = rawSection
		.split(",")
		.map(s => s.trim())
		.filter(s => (VALID as string[]).includes(s)) as SearchSection[];

	const result = searchContent(q, {
		sections: sections.length ? sections : undefined,
		limit: 50
	});

	return {
		q,
		section: sections.length === 1 ? sections[0] : "",
		result,
		suggestions: collectSuggestions(),
		sections: VALID.map(s => ({ key: s, label: SECTION_META[s].label }))
	};
}
