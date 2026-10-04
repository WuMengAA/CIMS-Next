/**
 * 更新日志与开发进度 —— 纯内容文件读取层。
 *
 * 为什么用 JSON 而不是 markdown 集合：更新日志要按「版本 + 条目类型」筛选渲染，
 * 结构化数据直接就能用；写成 markdown 反而要先解析 frontmatter 才能筛。
 */
import fs from "node:fs";
import path from "node:path";

import { CONTENT_DIR } from "./paths.js";
const CHANGELOG_FILE = path.join(CONTENT_DIR, "changelog.json");
const ROADMAP_FILE = path.join(CONTENT_DIR, "roadmap.json");

export type ChangeKind = "feat" | "fix" | "change" | "chore";

export interface ChangelogItem {
	kind: ChangeKind | string;
	text: string;
}

export interface ChangelogEntry {
	version: string;
	date: string;
	title: string;
	highlight?: string;
	items: ChangelogItem[];
	/**
	 * 对外可见性。缺省（字段不存在）= 已发布。
	 *
	 * ⚠️ 这个「缺省即真」是有意的历史兼容：2026-09 之前的旧数据里根本没有这个字段，
	 *    它们全都是已经对外展示过的版本。任何按 `published === true` 判定的写法都会让
	 *    这些老版本在 /changelog 上一夜之间全部消失 —— 判空一路自上而下只能是 `!== false`。
	 */
	published?: boolean;
}

export interface RoadmapItem {
	project: string;
	phase: string;
	progress: number;
	next: string;
	note?: string;
}

function readJson<T>(file: string, fallback: T): T {
	try {
		if (!fs.existsSync(file)) return fallback;
		const raw = fs.readFileSync(file, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		// 文件被手写坏了时不要让整站 500；返回空内容，页面上留一句说明即可。
		return (parsed ?? fallback) as T;
	} catch (e) {
		console.error(`[changelog] ${path.basename(file)} 解析失败：`, e instanceof Error ? e.message : e);
		return fallback;
	}
}

/** 版本倒序（同日期按版本号倒序）。 */
export function getChangelog(): ChangelogEntry[] {
	const list = readJson<ChangelogEntry[]>(CHANGELOG_FILE, []);
	if (!Array.isArray(list)) return [];
	return list
		.map((e) => ({
			version: String(e.version ?? ""),
			date: String(e.date ?? ""),
			title: String(e.title ?? ""),
			highlight: e.highlight ? String(e.highlight) : "",
			items: Array.isArray(e.items) ? e.items.filter((i) => i && i.text) : [],
			// 原样透传，不做布尔折叠：缺失与 true 都要能走到下面 getPublicChangelog 的可见侧。
			published: e.published
		}))
		.sort((a, b) => {
			if (a.date !== b.date) return b.date.localeCompare(a.date);
			return b.version.localeCompare(a.version);
		});
}

/**
 * 整表落盘。后台「更新日志」页的写路径，原样覆盖 content/changelog.json。
 *
 * 这里没有复用 content-store 的 ensureDirs()：它没导出，而 content-store 一旦被 import
 * 就会连带拉起 SQLite、markdown-it 全套 —— 为一个纯 JSON 写文件把整条工具链拖进
 * changelog 模块不划算（本模块是前后台共用的读取层）。mkdir CONTENT_DIR 一行就够。
 *
 * ⚠️ 本模块刻意不用 cachedJsonFile（读取层说明见文件头），所以写完**没有缓存要清**。
 */
export function saveChangelog(list: ChangelogEntry[]): void {
	fs.mkdirSync(CONTENT_DIR, { recursive: true });
	fs.writeFileSync(CHANGELOG_FILE, JSON.stringify(list, null, 2), "utf-8");
}

/**
 * 前台可用视图：只留对外可见的版本。
 *
 * 🔴 判定必须写成 `e.published !== false` —— 见 ChangelogEntry.published 上的注释。
 *    写成 `e.published === true` 会让所有没有该字段的历史版本在前台直接消失。
 */
export function getPublicChangelog(): ChangelogEntry[] {
	return getChangelog().filter((e) => e.published !== false);
}

export function getRoadmap(): { updated: string; items: RoadmapItem[] } {
	const raw = readJson<{ updated?: string; items?: RoadmapItem[] }>(ROADMAP_FILE, { updated: "", items: [] });
	const items = Array.isArray(raw.items)
		? raw.items
				.filter((i) => i && i.project)
				.map((i) => ({
					...i,
					phase: i.phase ?? "",
					progress: Math.max(0, Math.min(100, Math.round(Number(i.progress) || 0))),
					next: i.next ?? ""
				}))
				.sort((a, b) => b.progress - a.progress)
		: [];
	return { updated: raw.updated ?? "", items };
}

export const CHANGE_KIND_LABELS: Record<string, string> = {
	feat: "新增",
	fix: "修复",
	change: "调整",
	chore: "其它"
};
