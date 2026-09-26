/** /changelog —— 更新日志 + 项目开发进度。公开页，不登录也能看（运营透明度）。 */
import { getChangelog, getRoadmap, CHANGE_KIND_LABELS } from "$lib/server/changelog.js";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = () => {
	const entries = getChangelog();
	const roadmap = getRoadmap();
	const kinds = Object.keys(CHANGE_KIND_LABELS);
	// 统计条数放在服务端：前端只负责画，省得两边各算一遍对不上。
	const counts = kinds.map((k) => ({
		kind: k,
		label: CHANGE_KIND_LABELS[k],
		n: entries.reduce((s, e) => s + e.items.filter((i) => i.kind === k).length, 0)
	}));
	return { entries, roadmap, counts };
};
