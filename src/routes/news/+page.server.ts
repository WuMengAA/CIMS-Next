import { getAggregatedNews } from "$lib/server/rss.js";
import { getFeedConfig } from "$lib/server/content-store.js";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
	let items: any[] = [];
	let errorMsg: string | null = null;
	try {
		items = await getAggregatedNews();
	} catch {
		errorMsg = "聚合新闻暂时不可用，请稍后重试。";
	}
	const cfg = getFeedConfig();
	const sources = cfg.sources.filter((s) => s.enabled).map((s) => ({ name: s.name, category: s.category }));
	return { items, sources, error: errorMsg };
};
