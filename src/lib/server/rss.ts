import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { listItems, getAnnouncements, getSettings, getFeedConfig, getSiteUrl } from "$lib/server/content-store.js";

// ───────────────────────────────────────────────────────────────────────────
// RSS / Atom 解析、新闻聚合（带缓存）、RSS 2.0 生成、ClassIsland 播报合成。
// 设计原则：零外部依赖（解析用正则，避免引入 xml 库）；
// 远程抓取全部 try/catch，单个源失败不影响整体；结果落盘缓存，限流防抖。
// ───────────────────────────────────────────────────────────────────────────

const CONTENT_DIR = path.resolve("content");
const CACHE_DIR = path.join(CONTENT_DIR, "cache");
const NEWS_CACHE_FILE = path.join(CACHE_DIR, "news-cache.json");
const NEWS_TTL_MS = 10 * 60 * 1000; // 聚合结果缓存 10 分钟
const FETCH_TIMEOUT_MS = 9000;

export interface FeedItem {
	title: string;
	link: string;
	description: string;
	pubDate: string; // ISO 或 RFC822 均可
	guid?: string;
	source?: string;
	category?: string;
}

// ── 小工具 ────────────────────────────────────────────────────────────────
function decodeEntities(s: string): string {
	return s
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#0*39;/g, "'")
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&");
}
function stripTags(s: string): string {
	return decodeEntities(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function escapeXml(s: string): string {
	return (s || "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}
function toRfc822(dateInput?: string): string {
	const d = dateInput ? new Date(dateInput) : new Date();
	if (isNaN(d.getTime())) return new Date().toUTCString();
	return d.toUTCString();
}
function addDaysIso(dateInput: string, days: number): string {
	const d = new Date(dateInput || Date.now());
	if (isNaN(d.getTime())) return new Date(Date.now() + days * 864e5).toISOString();
	d.setDate(d.getDate() + days);
	return d.toISOString();
}
function hashId(input: string): string {
	return crypto.createHash("sha1").update(input).digest("hex").slice(0, 16);
}

// ── 单条字段提取 ──────────────────────────────────────────────────────────
function pickTag(block: string, tag: string): string {
	// 兼容 <tag>...</tag> 与 <tag attr="x">...</tag>
	const m = block.match(new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">", "i"));
	return m ? decodeEntities(m[1]).trim() : "";
}
function pickLink(block: string): string {
	// RSS: <link>url</link>
	const rss = pickTag(block, "link");
	if (rss) return rss;
	// Atom: <link href="url" .../>
	const m = block.match(/<link\b[^>]*?\bhref="([^"]+)"[^>]*\/?>/i);
	if (m) return decodeEntities(m[1]).trim();
	return "";
}

// ── 解析 RSS 2.0 / Atom ──────────────────────────────────────────────────
export function parseFeed(xml: string, sourceName?: string): { items: FeedItem[] } {
	if (!xml) return { items: [] };
	const isAtom = /<feed[\s>]/i.test(xml) && /<entry[\s>]/i.test(xml);
	const items: FeedItem[] = [];
	const blockRe = isAtom
		? /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi
		: /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
	let m: RegExpExecArray | null;
	while ((m = blockRe.exec(xml)) !== null) {
		const block = m[1];
		const title = pickTag(block, "title") || "(无标题)";
		const link = pickLink(block);
		if (!link && !title) continue;
		let desc = pickTag(block, "description") || pickTag(block, "summary") || pickTag(block, "content") || "";
		if (!desc) desc = pickTag(block, "content:encoded") || "";
		const pub = pickTag(block, "pubDate") || pickTag(block, "updated") || pickTag(block, "published") || pickTag(block, "dc:date") || "";
		const guid = pickTag(block, "guid") || pickTag(block, "id") || link;
		const cat = pickTag(block, "category");
		items.push({
			title: stripTags(title).slice(0, 200),
			link,
			description: stripTags(desc).slice(0, 600),
			pubDate: pub ? new Date(pub).toISOString() : new Date().toISOString(),
			guid: guid || link,
			source: sourceName,
			category: cat || undefined
		});
	}
	return { items };
}

// ── 抓取单个源 ────────────────────────────────────────────────────────────
async function fetchFeed(url: string, sourceName?: string, maxItems = 10): Promise<FeedItem[]> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			signal: ctrl.signal,
			redirect: "follow",
			headers: { "User-Agent": "StelarithFeedAggregator/1.0 (+" + (getSiteUrl("https://www.stelarith.com") || "https://www.stelarith.com") + "/)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" }
		});
		if (!res.ok) return [];
		const xml = await res.text();
		const parsed = parseFeed(xml, sourceName);
		return parsed.items.slice(0, maxItems).map((it) => ({ ...it, source: sourceName }));
	} catch {
		return [];
	} finally {
		clearTimeout(timer);
	}
}

// ── 聚合（带缓存） ───────────────────────────────────────────────────────
export async function getAggregatedNews(force = false): Promise<FeedItem[]> {
	if (!force) {
		try {
			if (fs.existsSync(NEWS_CACHE_FILE)) {
				const c = JSON.parse(fs.readFileSync(NEWS_CACHE_FILE, "utf-8"));
				if (c.items && Date.now() - (c.fetchedAt || 0) < NEWS_TTL_MS) return c.items as FeedItem[];
			}
		} catch { /* ignore */ }
	}
	const cfg = getFeedConfig();
	const enabled = cfg.sources.filter((s) => s.enabled && s.url);
	const results = await Promise.allSettled(enabled.map((s) => fetchFeed(s.url, s.name, s.maxItems)));
	const merged: FeedItem[] = [];
	for (const r of results) if (r.status === "fulfilled") merged.push(...r.value);
	// 去重（按 link/guid/标题）
	const seen = new Set<string>();
	const deduped = merged.filter((it) => {
		const k = (it.link || it.guid || it.title).trim();
		if (!k || seen.has(k)) return false;
		seen.add(k);
		return true;
	});
	deduped.sort((a, b) => (b.pubDate || "").localeCompare(a.pubDate || ""));
	const sliced = deduped.slice(0, 60);
	try {
		fs.mkdirSync(CACHE_DIR, { recursive: true });
		fs.writeFileSync(NEWS_CACHE_FILE, JSON.stringify({ fetchedAt: Date.now(), items: sliced }));
	} catch { /* ignore */ }
	return sliced;
}

// ── 博客 RSS 条目 ────────────────────────────────────────────────────────
export function getBlogRssItems(origin: string, author?: string): FeedItem[] {
	let posts = listItems("posts").filter((p) => p.status === "published");
	if (author) posts = posts.filter((p) => p.owner === author || (p as any).author === author);
	posts = posts.slice(0, 50);
	const settings = getSettings();
	return posts.map((p) => ({
		title: p.title,
		link: origin + "/posts/" + p.slug,
		description: (p.excerpt || "").slice(0, 600),
		pubDate: (p.updated || p.date) as string,
		guid: origin + "/posts/" + p.slug,
		category: p.category,
		author: author || (p.owner || (p as any).author || settings.title)
	}));
}

// ── 生成 RSS 2.0 ────────────────────────────────────────────────────────
export function buildRss(opts: {
	title: string;
	link: string;
	description: string;
	items: FeedItem[];
	selfUrl?: string;
	language?: string;
}): string {
	const language = opts.language || "zh-CN";
	const itemsXml = opts.items
		.map((it) => {
			const cat = it.category ? `\n    <category>${escapeXml(it.category)}</category>` : "";
			const author = it.author ? `\n    <author>${escapeXml(it.author)}</author>` : "";
			return `  <item>
    <title>${escapeXml(it.title)}</title>
    <link>${escapeXml(it.link)}</link>
    <guid isPermaLink="false">${escapeXml(it.guid || it.link)}</guid>
    <pubDate>${toRfc822(it.pubDate)}</pubDate>${cat}${author}
    <description><![CDATA[${it.description || ""}]]></description>
  </item>`;
		})
		.join("\n");
	const self = opts.selfUrl ? `\n  <atom:link href="${escapeXml(opts.selfUrl)}" rel="self" type="application/rss+xml" />` : "";
	return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escapeXml(opts.title)}</title>
    <link>${escapeXml(opts.link)}</link>
    <description>${escapeXml(opts.description)}</description>
    <language>${escapeXml(language)}</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <generator>Stelarith</generator>${self}
${itemsXml}
  </channel>
</rss>`;
}

// ── 合成 ClassIsland Web 公告源（WebAnnouncementProvider 格式） ─────────────
// ClassIsland 的「Web 公告」提供方会从 URL 拉取一个 JSON，结构：
// { "announcements": [ { guid, summary, details, severity, startTime, endTime, hasDetails, detailsUri, detailsOpenUri } ] }
// severity: 0=一般 1=重要 2=紧急。时间用 ISO8601。公告会作为大屏提醒被「播报」出来。
function sevFromLevel(level?: string): number {
	switch ((level || "").toLowerCase()) {
		case "warning":
			return 1;
		case "danger":
			return 2;
		default:
			return 0;
	}
}

export async function getClassIslandAnnouncements(origin: string, forceRefresh = false): Promise<{ announcements: any[] }> {
	const cfg = getFeedConfig();
	const s = cfg.settings;
	const out: any[] = [];

	// 1) 站点公告
	if (s.includeAnnouncementsInBroadcast) {
		for (const a of getAnnouncements({ activeOnly: true })) {
			const details = stripTags(a.content || "");
			out.push({
				guid: "stelarith-ann-" + a.id,
				summary: a.title,
				details,
				severity: sevFromLevel(a.level),
				startTime: a.startsAt || new Date().toISOString(),
				endTime: a.endsAt || addDaysIso(new Date().toISOString(), s.newsWindowDays),
				hasDetails: !!details,
				detailsUri: origin + "/announcements",
				detailsOpenUri: true
			});
		}
	}

	// 2) 最新博客文章
	if (s.includePostsInBroadcast) {
		const posts = listItems("posts")
			.filter((p) => p.status === "published")
			.sort((a, b) => (b.date || "").localeCompare(a.date || ""))
			.slice(0, s.maxPostsInBroadcast);
		for (const p of posts) {
			const link = origin + "/posts/" + p.slug;
			out.push({
				guid: "stelarith-post-" + p.slug,
				summary: "新文章：" + p.title,
				details: stripTags(p.excerpt || ""),
				severity: s.broadcastSeverity,
				startTime: (p.updated || p.date) as string,
				endTime: addDaysIso((p.updated || p.date) as string, s.newsWindowDays),
				hasDetails: true,
				detailsUri: link,
				detailsOpenUri: true
			});
		}
	}

	// 3) 聚合新闻
	if (s.includeNewsInBroadcast) {
		const news = await getAggregatedNews(forceRefresh);
		for (const n of news.slice(0, s.maxNewsItems)) {
			out.push({
				guid: "stelarith-news-" + hashId(n.link || n.guid || n.title),
				summary: (n.source ? "[" + n.source + "] " : "") + n.title,
				details: n.description,
				severity: s.broadcastSeverity,
				startTime: n.pubDate,
				endTime: addDaysIso(n.pubDate, s.newsWindowDays),
				hasDetails: true,
				detailsUri: n.link,
				detailsOpenUri: true
			});
		}
	}

	return { announcements: out };
}
