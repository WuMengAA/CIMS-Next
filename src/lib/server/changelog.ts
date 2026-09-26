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
			items: Array.isArray(e.items) ? e.items.filter((i) => i && i.text) : []
		}))
		.sort((a, b) => {
			if (a.date !== b.date) return b.date.localeCompare(a.date);
			return b.version.localeCompare(a.version);
		});
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
