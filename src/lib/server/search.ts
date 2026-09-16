/**
 * 全站搜索（跨 posts / projects / docs / pages）。
 *
 * 设计取舍：
 * - 内容规模小（几十篇 Markdown），直接在内存里线性扫描即可，无需引入索引库/外部服务。
 * - 只索引 status === "published" 的内容——草稿与归档不应出现在公开搜索结果里。
 * - 打分按「命中位置的重要程度」加权：标题 > 标签/分类 > 摘要 > 正文。
 * - 返回的 snippet 是**纯文本**，命中区间以 [start, end) 偏移量标出。
 *   前端据此把纯文本切成若干片段渲染 <mark>，全程避免 {@html}，从根上杜绝 XSS。
 */

import { listItems } from "./content-store.js";
import type { ContentItem } from "./content-store.js";

export type SearchSection = "posts" | "projects" | "docs" | "pages";

export const SECTION_META: Record<SearchSection, { label: string; hrefPrefix: string }> = {
	posts: { label: "博客", hrefPrefix: "/posts/" },
	projects: { label: "项目", hrefPrefix: "/projects/" },
	docs: { label: "教程", hrefPrefix: "/docs/" },
	pages: { label: "页面", hrefPrefix: "/pages/" }
};

export interface SearchRange {
	start: number;
	end: number;
}

export interface SearchHit {
	section: SearchSection;
	sectionLabel: string;
	slug: string;
	title: string;
	href: string;
	date: string;
	category?: string;
	tags?: string[];
	score: number;
	/** 纯文本片段（已去除 Markdown 标记） */
	snippet: string;
	/** snippet 内的命中区间，升序、互不重叠 */
	ranges: SearchRange[];
	/** 标题是否命中（用于前端高亮标题） */
	titleHit: boolean;
	titleRanges: SearchRange[];
}

export interface SearchResult {
	query: string;
	terms: string[];
	total: number;
	hits: SearchHit[];
	/** 各栏目命中数，便于展示分类计数 */
	bySection: Record<SearchSection, number>;
}

/** frontmatter 的 date 被 js-yaml 解析后是 Date 对象，统一成 YYYY-MM-DD 再展示。 */
function fmtDate(v: unknown): string {
	if (!v) return "";
	const d = v instanceof Date ? v : new Date(String(v));
	return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
}

/** 把 Markdown 正文压成便于检索/展示的纯文本。 */
function toPlainText(body: string): string {
	return body
		// 代码块围栏保留内容，去掉围栏本身
		.replace(/```[^\n]*\n?/g, " ")
		// 图片整体丢弃，链接只留文字
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		// 行内代码 / 强调 / 标题井号等标记
		.replace(/[`*_~>#|]/g, " ")
		// 表格分隔线
		.replace(/^\s*[-: ]+\s*$/gm, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** 在一段纯文本里找出所有（不区分大小写）的命中区间，合并重叠部分。 */
function findRanges(text: string, terms: string[]): SearchRange[] {
	if (!terms.length) return [];
	const lower = text.toLowerCase();
	const raw: SearchRange[] = [];
	for (const term of terms) {
		if (!term) continue;
		const t = term.toLowerCase();
		let from = 0;
		while (from <= lower.length - t.length) {
			const idx = lower.indexOf(t, from);
			if (idx === -1) break;
			raw.push({ start: idx, end: idx + t.length });
			from = idx + t.length;
		}
	}
	if (!raw.length) return [];
	raw.sort((a, b) => a.start - b.start || a.end - b.end);
	const merged: SearchRange[] = [raw[0]];
	for (let i = 1; i < raw.length; i++) {
		const last = merged[merged.length - 1];
		const cur = raw[i];
		if (cur.start <= last.end) last.end = Math.max(last.end, cur.end);
		else merged.push(cur);
	}
	return merged;
}

/** 围绕首个命中截取一段上下文窗口。 */
function makeSnippet(text: string, ranges: SearchRange[], window = 100): { snippet: string; ranges: SearchRange[] } {
	if (!text) return { snippet: "", ranges: [] };
	if (!ranges.length) {
		const head = text.slice(0, window * 2);
		return { snippet: head + (text.length > head.length ? "…" : ""), ranges: [] };
	}
	const first = ranges[0];
	let start = Math.max(0, first.start - Math.floor(window / 2));
	// 尽量避免从词中间截断
	if (start > 0) {
		const sp = text.indexOf(" ", start);
		if (sp !== -1 && sp - start < 12) start = sp + 1;
	}
	let end = Math.min(text.length, start + window * 2);
	const prefix = start > 0 ? "…" : "";
	const suffix = end < text.length ? "…" : "";
	const slice = text.slice(start, end);
	const shifted = ranges
		.filter(r => r.end > start && r.start < end)
		.map(r => ({ start: Math.max(0, r.start - start), end: Math.min(slice.length, r.end - start) }));
	const offset = prefix.length;
	return { snippet: prefix + slice + suffix, ranges: shifted.map(r => ({ start: r.start + offset, end: r.end + offset })) };
}

/** 把查询串拆成去重后的关键词（空格分隔，忽略 1 字符以下的噪声）。 */
export function parseTerms(query: string): string[] {
	return Array.from(
		new Set(
			query
				.trim()
				.toLowerCase()
				.split(/\s+/)
				.map(t => t.trim())
				.filter(t => t.length >= 1)
		)
	);
}

function countOccurrences(haystack: string, terms: string[]): number {
	if (!haystack) return 0;
	const lower = haystack.toLowerCase();
	let n = 0;
	for (const t of terms) {
		let from = 0;
		while (from <= lower.length - t.length) {
			const idx = lower.indexOf(t, from);
			if (idx === -1) break;
			n++;
			from = idx + t.length;
		}
	}
	return n;
}

export interface SearchOptions {
	/** 限定栏目；为空则全站。 */
	sections?: SearchSection[];
	limit?: number;
}

const ALL_SECTIONS: SearchSection[] = ["posts", "projects", "docs", "pages"];

export function searchContent(query: string, opts: SearchOptions = {}): SearchResult {
	const terms = parseTerms(query);
	const bySection: Record<SearchSection, number> = { posts: 0, projects: 0, docs: 0, pages: 0 };
	const empty: SearchResult = { query, terms, total: 0, hits: [], bySection };
	if (!terms.length) return empty;

	const sections = opts.sections && opts.sections.length ? opts.sections : ALL_SECTIONS;
	const limit = opts.limit && opts.limit > 0 ? opts.limit : 60;
	const hits: SearchHit[] = [];

	for (const section of sections) {
		const meta = SECTION_META[section];
		for (const item of listItems(section) as ContentItem[]) {
			if (item.status !== "published") continue;

			const title = item.title || "";
			const tags = Array.isArray(item.tags) ? (item.tags as string[]) : [];
			const category = (item.category as string) || "";
			const excerpt = (item.excerpt as string) || "";
			const plain = toPlainText(item.body || "");

			// 所有关键词都必须至少命中一处（AND 语义），否则该条目不算命中
			const haystack = [title, category, tags.join(" "), excerpt, plain].join(" \u0000 ").toLowerCase();
			if (!terms.every(t => haystack.includes(t))) continue;

			const titleRanges = findRanges(title, terms);
			const tagHits = countOccurrences([category, tags.join(" ")].join(" "), terms);
			const excerptHits = countOccurrences(excerpt, terms);
			const bodyHits = countOccurrences(plain, terms);

			let score = 0;
			if (titleRanges.length) score += 40 + titleRanges.length * 4;
			score += tagHits * 12;
			score += excerptHits * 5;
			score += bodyHits * 1;
			// 标题越短越可能是「专指该条目」，轻微加权
			if (titleRanges.length && title.length <= 12) score += 4;

			const bodyRanges = findRanges(plain, terms);
			const { snippet, ranges } = makeSnippet(plain, bodyRanges);

			hits.push({
				section,
				sectionLabel: meta.label,
				slug: item.slug,
				title,
				href: meta.hrefPrefix + item.slug,
				date: fmtDate(item.date),
				...(category ? { category } : {}),
				...(tags.length ? { tags } : {}),
				score,
				snippet,
				ranges,
				titleHit: titleRanges.length > 0,
				titleRanges
			});
		}
	}

	hits.sort((a, b) => b.score - a.score || b.date.localeCompare(a.date));

	for (const h of hits) bySection[h.section]++;

	return {
		query,
		terms,
		total: hits.length,
		hits: hits.slice(0, limit),
		bySection
	};
}
