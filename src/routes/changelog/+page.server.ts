/** /changelog —— 更新日志 + 项目开发进度。公开页，不登录也能看（运营透明度）。 */
import { getPublicChangelog, getRoadmap, CHANGE_KIND_LABELS } from "$lib/server/changelog.js";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = () => {
	// 用 getPublicChangelog（而非 getChangelog）：后台标为「草稿」的版本不对外露出。
	// 判定是 published !== false，缺字段的历史版本一律视为已发布，不会消失。
	const entries = getPublicChangelog();
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
