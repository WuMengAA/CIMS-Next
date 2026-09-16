import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import matter from "gray-matter";
import markdownIt from "markdown-it";
import markdownItAnchor from "markdown-it-anchor";
import hljs from "highlight.js";
import katexPlugin from "markdown-it-katex";
import taskLists from "markdown-it-task-lists";
import footnote from "markdown-it-footnote";
import { applyMarkdownExtensions } from "./markdown-extensions.js";
import { getUser as getSqlUser } from "./auth.js";

// ── 运行时 .env 加载 ──────────────────────────────────────────────────────────
// adapter-node 的 `node build/index.js` 不会自动读取 .env（vite 只在构建期注入）。
// 部署端 start.sh 会 source .env 再启动，本函数作为兜底：若进程环境里没有对应变量，
// 则从 cwd 的 .env 解析并填入 process.env（不覆盖已存在的变量，避免与部署脚本冲突）。
let __envLoaded = false;
function ensureRuntimeEnv() {
	if (__envLoaded) return;
	__envLoaded = true;
	try {
		const envPath = path.join(process.cwd(), ".env");
		if (!fs.existsSync(envPath)) return;
		const text = fs.readFileSync(envPath, "utf-8");
		for (const raw of text.split("\n")) {
			const line = raw.trim();
			if (!line || line.startsWith("#")) continue;
			const eq = line.indexOf("=");
			if (eq === -1) continue;
			const key = line.slice(0, eq).trim();
			let val = line.slice(eq + 1).trim();
			if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
				val = val.slice(1, -1);
			}
			if (key && process.env[key] === undefined) process.env[key] = val;
		}
	} catch { /* ignore */ }
}

export interface ContentItem {
	slug: string;
	title: string;
	date: string;
	updated?: string;
	category?: string;
	tags?: string[];
	excerpt?: string;
	body: string;
	cover?: string;
	status: "draft" | "published" | "archived";
	order?: number;
	pinned?: boolean;
	owner?: string;
	folder?: string;
	[key: string]: unknown;
}

const CONTENT_DIR = path.resolve("content");
const UPLOADS_DIR = path.resolve("uploads");
const ARCHIVE_DIR = path.join(CONTENT_DIR, "archive");

const sections: Record<string, string> = {
	posts: path.join(CONTENT_DIR, "posts"),
	projects: path.join(CONTENT_DIR, "projects"),
	docs: path.join(CONTENT_DIR, "docs"),
	pages: path.join(CONTENT_DIR, "pages")
};

const md = markdownIt({
	html: true,
	linkify: true,
	typographer: true,
	highlight(str: string, lang: string): string {
		if (lang && hljs.getLanguage(lang)) {
			try {
				return '<pre><code class="hljs language-' + lang + '">' + hljs.highlight(str, { language: lang, ignoreIllegals: true }).value + '</code></pre>';
			} catch (e) {
				/* fallthrough */
			}
		}
		return '<pre><code class="hljs">' + md.utils.escapeHtml(str) + '</code></pre>';
	}
});
(md as any).use(markdownItAnchor, { permalink: false, space: 0, slugify: (s: string) => s.toLowerCase().replace(/[^\w\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "") });
(md as any).use(katexPlugin, { throwOnError: false });
(md as any).use(taskLists, { enabled: true, label: true });
(md as any).use(footnote);
// 补齐原生 markdown-it 不支持的常用写法：上标/下标/高亮/callout 提示块
applyMarkdownExtensions(md as any);

function ensureDirs() {
	for (const dir of Object.values(sections)) {
		fs.mkdirSync(dir, { recursive: true });
	}
	fs.mkdirSync(UPLOADS_DIR, { recursive: true });
	fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
}

// ───────────────────────────────────────────────────────────────────────────
// 进程内缓存层（adapter-node 单进程长驻，模块级 Map 跨请求复用）
//
// 解决的核心问题：公开流量下，每次请求都要「整段 section 全量读盘 + matter 解析」
// （listItems），以及「markdown-it + highlight.js 重渲染」（renderMarkdown）。
// 二者原本都没有缓存，列表页/RSS/搜索/详情页每次都重算，CPU 与磁盘 IO 浪费严重。
//
// 失效策略：
//   - 列表 listCache：由写入函数（saveItem/deleteItem/restoreVersion）显式失效。
//     不依赖目录 mtime——改写已有文件只刷新文件 mtime 而非目录 mtime，会误判为未变。
//     外部改动（git pull）一般在部署重启时自然失效，属可接受边界。
//   - JSON jsonCache：整文件重写 → 文件 mtime 必变，以 mtime 为准（可靠）。
//   - 渲染 mdCache：以 markdown 内容 sha1 为键，内容变即新键自然 miss，旧键惰性淘汰。
// ───────────────────────────────────────────────────────────────────────────

/** 轻量 mtime 读取（不存在返回 -1）。 */
function statMtime(p: string): number {
	try {
		return fs.statSync(p).mtimeMs;
	} catch {
		return -1;
	}
}

const listCache = new Map<string, { items: ContentItem[] }>();
const jsonCache = new Map<string, { mtime: number; data: unknown }>();
const mdCache = new Map<string, RenderedContent>();
const MD_CACHE_MAX = 512;

/**
 * 读取并缓存一个 JSON 文件。mtime 命中则直接返回缓存对象，避免每次请求 JSON.parse。
 * 写入方在改写文件后须使对应缓存失效（writeJsonArray / saveSettings / saveNav 已处理）。
 */
function cachedJsonFile<T>(filePath: string, fallback: T): T {
	const m = statMtime(filePath);
	const hit = jsonCache.get(filePath);
	if (hit && hit.mtime === m) return hit.data as T;
	try {
		const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
		jsonCache.set(filePath, { mtime: m, data });
		return data;
	} catch {
		return fallback;
	}
}

/** 显式失效列表缓存（某 section 写入后调用；不传则清空全部）。 */
export function invalidateContentCache(section?: "posts" | "projects" | "docs" | "pages"): void {
	if (section) listCache.delete(section);
	else listCache.clear();
}

export function listItems(section: "posts" | "projects" | "docs" | "pages"): ContentItem[] {
	ensureDirs();
	const dir = sections[section];
	if (!fs.existsSync(dir)) return [];
	// 进程内缓存：列表结果跨请求复用，仅在写入函数显式失效后才重读。
	const cached = listCache.get(section);
	if (cached) return cached.items;
	const files = fs.readdirSync(dir).filter(f => f.endsWith(".md"));
	const items: ContentItem[] = [];
	for (const file of files) {
		const filePath = path.join(dir, file);
		const raw = fs.readFileSync(filePath, "utf-8");
		const { data, content } = matter(raw);
		const base: ContentItem = {
			slug: file.replace(/\.md$/, ""),
			title: (data.title as string) || file.replace(/\.md$/, ""),
			date: (data.date as string) || new Date().toISOString().slice(0, 10),
			body: content.trim(),
			status: (data.status as ContentItem["status"]) || "published"
		};
		if (data.updated) base.updated = data.updated;
		if (data.category) base.category = data.category;
		if (data.tags) base.tags = data.tags;
		if (data.excerpt) base.excerpt = data.excerpt;
		if (data.cover) base.cover = data.cover;
		if (data.order !== undefined) base.order = data.order;
		if (data.pinned !== undefined) base.pinned = data.pinned;
		if (data.owner) base.owner = data.owner;
			if (data.folder) base.folder = data.folder;
		items.push(base);
	}
	const sorted = items.sort((a, b) => {
		if (a.pinned && !b.pinned) return -1;
		if (!a.pinned && b.pinned) return 1;
		if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
		return b.date.localeCompare(a.date);
	});
	listCache.set(section, { items: sorted });
	return sorted;
}

/**
 * 列表 / 导航用的轻量摘要。
 *
 * 剥离 body，避免 SSR 把整站正文内联进 HTML——此前列表页与详情页都直接
 * 返回完整 ContentItem，导致每个页面都序列化了全部文档正文（单页 60KB+，
 * 且同一份正文在 7 个页面里重复出现）。只有详情页的当前文章才需要 body。
 */
export function toSummary(item: ContentItem): Omit<ContentItem, "body"> & { excerpt: string } {
	const { body, ...rest } = item;
	const excerpt =
		rest.excerpt ||
		body
			.replace(/[#*`>\[\]()!|-]/g, "")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, 120);
	return { ...rest, excerpt };
}

export function getItem(section: "posts" | "projects" | "docs" | "pages", slug: string): ContentItem | null {
	ensureDirs();
	const filePath = path.join(sections[section], slug + ".md");
	if (!fs.existsSync(filePath)) return null;
	const raw = fs.readFileSync(filePath, "utf-8");
	const { data, content } = matter(raw);
	return {
		slug,
		title: (data.title as string) || slug,
		date: (data.date as string) || new Date().toISOString().slice(0, 10),
		body: content.trim(),
		status: (data.status as ContentItem["status"]) || "published",
		...(data.updated ? { updated: data.updated } : {}),
		...(data.category ? { category: data.category } : {}),
		...(data.tags ? { tags: data.tags } : {}),
		...(data.excerpt ? { excerpt: data.excerpt } : {}),
		...(data.cover ? { cover: data.cover } : {}),
		...(data.order !== undefined ? { order: data.order } : {}),
		...(data.pinned !== undefined ? { pinned: data.pinned } : {}),
		...(data.owner ? { owner: data.owner } : {}),
		...(data.folder ? { folder: data.folder } : {}),
		...(data.repoUrl ? { repoUrl: data.repoUrl } : {}),
		...(data.siteUrl ? { siteUrl: data.siteUrl } : {}),
		// ---- 页面设计字段（pages 用）----
		// 布尔字段从 frontmatter 读回来可能是字符串 "true"（编辑器写入时统一转成字符串），
		// 这里归一为布尔，避免模板里 "true" 被当成 falsy 之外的真值而语义混乱。
		...(data.layout ? { layout: data.layout } : {}),
		...(data.hero ? { hero: data.hero } : {}),
		...(data.aside !== undefined ? { aside: data.aside === true || data.aside === "true" } : {}),
		...(data.toc !== undefined ? { toc: data.toc === true || data.toc === "true" } : {}),
		...(data.hideTitle !== undefined ? { hideTitle: data.hideTitle === true || data.hideTitle === "true" } : {}),
		...(data.noindex !== undefined ? { noindex: data.noindex === true || data.noindex === "true" } : {}),
	...(data.accent ? { accent: data.accent } : {}),
	...(data.navTitle ? { navTitle: data.navTitle } : {}),
	...(data.icon ? { icon: data.icon } : {})
};
}

/**
 * 受管字段白名单。只有这些字段由调用方（编辑器 / 排序 / 审核）负责读写；
 * 其余任何字段（updated、repoUrl、siteUrl、历史遗留的自定义字段……）
 * 一律从磁盘上的原文件**原样继承**，绝不在保存或排序时被抹掉。
 *
 * 曾经的实现是「用白名单重建 frontmatter」，配合 reorderItems 只向下传部分字段，
 * 导致一次「上移/下移」就会把 owner / folder / updated 等字段从文章里删掉——
 * 属于静默数据丢失，必须避免。
 */
const MANAGED_FRONTMATTER_KEYS = [
	"title", "date", "status", "updated",
	"category", "tags", "excerpt", "cover",
	"order", "pinned", "owner", "folder",
	// ---- 页面编辑器的设计字段（仅对 pages 有意义，其它 section 写了也无害） ----
	// layout  版心宽度：narrow | standard | wide | full
	// aside   是否带侧栏目录
	// hero    页头样式：none | plain | banner（banner 用 cover 做背景）
	// accent  主题色（十六进制），覆盖该页主色
	// toc     是否显示目录
	// hideTitle 是否隐藏正文大标题（内容里已手写标题时用）
	// navTitle 侧栏/导航里显示的短标题
	// noindex 搜索引擎不索引
	// icon 页面图标键（由图形化图标选择器写入，前台导航/特性卡展示用）
	"layout", "aside", "hero", "accent", "toc", "hideTitle", "navTitle", "noindex", "icon"
] as const;

export function saveItem(
	section: "posts" | "projects" | "docs" | "pages",
	item: Partial<ContentItem> & { title: string; body: string }
): ContentItem {
	ensureDirs();
	const slug = item.slug || item.title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "");
	const filePath = path.join(sections[section], slug + ".md");

	// 1) 读取磁盘上已有文件的 frontmatter 作为基线，保留全部未知字段
	const existing: Record<string, unknown> = {};
	let prevBody = "";
	if (fs.existsSync(filePath)) {
		const prev = matter(fs.readFileSync(filePath, "utf-8"));
		Object.assign(existing, prev.data || {});
		prevBody = (prev.content || "").trim();
	}

	// 2) 白名单字段按入参覆盖：
	//    - 入参显式给出（且非空）→ 覆盖
	//    - 入参显式给 null/""/undefined → 视为清空，删除该字段
	//    - 入参完全没提到该字段 → 继承旧值（这样只改 order 的排序调用不会误伤其它字段）
	const incoming = item as Record<string, unknown>;
	const frontmatter: Record<string, unknown> = { ...existing };
	for (const key of MANAGED_FRONTMATTER_KEYS) {
		if (!(key in incoming)) continue;
		const v = incoming[key];
		if (v === undefined || v === null || v === "") delete frontmatter[key];
		else frontmatter[key] = v;
	}

	// 3) 必填字段兜底（title/date/status 永远存在）
	frontmatter.title = item.title;
	if (!frontmatter.date) frontmatter.date = new Date().toISOString().slice(0, 10);
	if (!frontmatter.status) frontmatter.status = "published";

	// 4) 正文发生变化时自动刷新 updated（调用方显式指定则尊重调用方）
	if (item.updated === undefined && fs.existsSync(filePath) && prevBody !== item.body.trim()) {
		frontmatter.updated = new Date().toISOString().slice(0, 10);
	}

	const raw = matter.stringify(item.body, frontmatter);
	fs.writeFileSync(filePath, raw, "utf-8");
	// 写版本快照：每次保存都追加一条到 content/archive/[section]/[slug].jsonl
	appendVersionSnapshot(section, slug, raw, (item.editor as string) || "system");
	// 内容已变 → 该 section 列表缓存失效，下次读取重新聚合（标题/日期/order/cover 等）。
	invalidateContentCache(section);
	return getItem(section, slug)!;
}

export interface ContentVersion { id: string; version: number; savedAt: string; editor: string; size: number; }

function archiveFile(section: string, slug: string): string {
	return path.join(ARCHIVE_DIR, `${section}.${slug}.jsonl`);
}

function appendVersionSnapshot(section: string, slug: string, raw: string, editor: string): void {
	try {
		const file = archiveFile(section, slug);
		let version = 0;
		if (fs.existsSync(file)) {
			const lines = fs.readFileSync(file, "utf-8").trim().split("\n").filter(Boolean);
			version = lines.length;
		}
		const snap = { id: "v" + (version + 1) + "-" + Date.now().toString(36), version: version + 1, savedAt: new Date().toISOString(), editor, raw, size: Buffer.byteLength(raw) };
		fs.appendFileSync(file, JSON.stringify(snap) + "\n", "utf-8");
	} catch (e) {
		console.error("archive snapshot failed:", e);
	}
}

export function getVersions(section: "posts" | "projects" | "docs" | "pages", slug: string): ContentVersion[] {
	const file = archiveFile(section, slug);
	if (!fs.existsSync(file)) return [];
	const lines = fs.readFileSync(file, "utf-8").trim().split("\n").filter(Boolean);
	return lines.map(l => {
		try {
			const s = JSON.parse(l);
			return { id: s.id, version: s.version, savedAt: s.savedAt, editor: s.editor, size: s.size };
		} catch { return null; }
	}).filter(Boolean) as ContentVersion[];
}

export function getVersionRaw(section: "posts" | "projects" | "docs" | "pages", slug: string, versionId: string): string | null {
	const file = archiveFile(section, slug);
	if (!fs.existsSync(file)) return null;
	const lines = fs.readFileSync(file, "utf-8").trim().split("\n").filter(Boolean);
	for (const l of lines) {
		try { const s = JSON.parse(l); if (s.id === versionId) return s.raw; } catch { /* skip */ }
	}
	return null;
}

export function restoreVersion(section: "posts" | "projects" | "docs" | "pages", slug: string, versionId: string): boolean {
	const raw = getVersionRaw(section, slug, versionId);
	if (!raw) return false;
	// 写入当前文件（会再次触发快照，形成历史链）
	fs.writeFileSync(path.join(sections[section], slug + ".md"), raw, "utf-8");
	invalidateContentCache(section);
	return true;
}

export function deleteItem(section: "posts" | "projects" | "docs" | "pages", slug: string): boolean {
	ensureDirs();
	const filePath = path.join(sections[section], slug + ".md");
	if (fs.existsSync(filePath)) {
		fs.unlinkSync(filePath);
		invalidateContentCache(section);
		return true;
	}
	return false;
}

export function reorderItems(section: "posts" | "projects" | "docs" | "pages", orderedSlugs: string[]): void {
	ensureDirs();
	for (let index = 0; index < orderedSlugs.length; index++) {
		const item = getItem(section, orderedSlugs[index]);
		// 传全量字段再叠加 order：排序只应改变顺序，不应触碰 owner/folder/updated 等
		if (item) saveItem(section, { ...item, order: index });
	}
}

export interface RenderedContent { html: string; toc: { id: string; text: string; level: number }[]; words: number; }

// GFM 表格块要求表头/分隔行/数据行连续。用户在编辑器或复制内容时，
// 常在表格行之间插入空行，导致 markdown-it 不识别为表格而原样显示管道符。
// 渲染前把"夹在表格行之间的空行"剔除，恢复连续表格块。
function fixTableBlocks(src: string): string {
	const lines = src.split("\n");
	const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
	const out: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const prev = out.length ? out[out.length - 1] : null;
		const cur = lines[i];
		const next = lines[i + 1];
		if (cur.trim() === "" && prev !== null && isTableRow(prev) && next !== undefined && isTableRow(next)) {
			continue;
		}
		out.push(cur);
	}
	return out.join("\n");
}

export function renderMarkdown(mdContent: string): RenderedContent {
	// 渲染缓存：markdown 内容 sha1 为键。highlight.js 语法高亮是该路径最贵的部分，
	// 缓存后同一篇文章的重复访问（含 SWR 重渲染）直接命中，省去整段重解析+高亮。
	const key = crypto.createHash("sha1").update(mdContent).digest("hex");
	const hit = mdCache.get(key);
	if (hit) return hit;
	// Images render progressively: off-screen content images load lazily.
	// referrerpolicy="no-referrer"：正文图片常引用 B 站图床（i*.hdslb.com）等有防盗链的站点，
	// 带本站 Referer 会被 403 变成裂图；去掉 Referer 后正常显示。对本站图片无副作用。
	const html = md
		.render(fixTableBlocks(mdContent))
		.replace(/<img /g, '<img loading="lazy" decoding="async" referrerpolicy="no-referrer" ');
	const toc: { id: string; text: string; level: number }[] = [];
	const headingRe = /<h([23])\s+id="([^"]*)"[^>]*>([\s\S]*?)<\/h\1>/g;
	let m: RegExpExecArray | null;
	while ((m = headingRe.exec(html)) !== null) {
		const text = m[3].replace(/<[^>]+>/g, "").trim();
		if (text) toc.push({ id: m[2], text, level: parseInt(m[1], 10) });
	}
	const words = mdContent.replace(/[#*`\[\]()!>\-\s]/g, "").length;
	const result: RenderedContent = { html, toc, words };
	mdCache.set(key, result);
	// 惰性淘汰最旧的一半，避免长文站点内存无限增长（Map 保持插入序 → 旧键在前）。
	if (mdCache.size > MD_CACHE_MAX) {
		let i = 0;
		const drop = Math.floor(MD_CACHE_MAX / 2);
		for (const k of mdCache.keys()) {
			if (i++ >= drop) break;
			mdCache.delete(k);
		}
	}
	return result;
}

export function uploadFile(filename: string, data: Buffer): { url: string; error?: string } {
	ensureDirs();
	const ALLOWED_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".pdf", ".txt", ".md", ".mp4", ".webm", ".mov", ".mp3", ".wav", ".ogg"]);
	const MAX_FILE_SIZE = 20 * 1024 * 1024;
	const ext = path.extname(filename).toLowerCase();
	if (!ALLOWED_EXT.has(ext)) return { url: "", error: "不支持的文件类型: " + ext };
	if (data.length > MAX_FILE_SIZE) return { url: "", error: "文件超过 20MB 限制" };
	const newFilename = path.basename(filename, ext) + "-" + Date.now() + ext;
	fs.writeFileSync(path.join(UPLOADS_DIR, newFilename), data);
	return { url: "/uploads/" + newFilename };
}

export function listUploads(): { filename: string; url: string; size: number; date: string }[] {
	ensureDirs();
	if (!fs.existsSync(UPLOADS_DIR)) return [];
	return fs.readdirSync(UPLOADS_DIR).filter(f => !f.startsWith(".")).map(f => {
		const stat = fs.statSync(path.join(UPLOADS_DIR, f));
		return { filename: f, url: "/uploads/" + f, size: stat.size, date: stat.birthtime.toISOString().slice(0, 10) };
	}).sort((a, b) => b.date.localeCompare(a.date));
}

export function deleteUpload(filename: string): boolean {
	ensureDirs();
	const filePath = path.join(UPLOADS_DIR, path.basename(filename));
	if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); return true; }
	return false;
}

export function getTags(section: "posts" | "projects" | "docs" | "pages"): string[] {
	const set = new Set<string>();
	for (const it of listItems(section)) for (const t of it.tags || []) set.add(t);
	return [...set].sort();
}

export function getCategories(section: "posts" | "projects" | "docs" | "pages"): string[] {
	const set = new Set<string>();
	for (const it of listItems(section)) if (it.category) set.add(it.category);
	return [...set].sort();
}

export function getFolders(section: "posts" | "projects" | "docs" | "pages"): string[] {
	const set = new Set<string>();
	for (const it of listItems(section)) if (it.folder) set.add(it.folder);
	return [...set].sort();
}



export interface SiteSettings {
	title: string;
	description: string;
	siteName: string;
	slogan: string;
	heroTitle: string;
	heroSubtitle: string;
	heroBadge: string;
	features: { title: string; description: string; icon?: string }[];
	socialTitle: string;
	footer: string;
	socials: { name: string; url: string }[];
	outboundWhitelist: string[];
	background: { style: string; color1: string; color2: string; color3: string; intensity: number; speed: number; particles: boolean }
}

function getDefaultSettings(): SiteSettings {
	return {
		title: "Stelarith",
		description: "一个收纳创作、记录与兴趣的个人互联网空间。",
		siteName: "Stelarith 工作台",
		slogan: "Protect What You Love. 守护珍爱之物。",
		heroTitle: "这一次，从出发。",
		heroSubtitle: "您的浏览体验永远是第一位的。一个好的网站应当有统一的主题、良好的交互和极高的性能。",
		heroBadge: "小而清晰，先把每一次打开做好",
		features: [
			{ title: "静态导出", description: "全站 HTML 直出，人类可读，搜索引擎易读，AI 能读。", icon: "file-code" },
			{ title: "统一设计", description: "采用 Shadcn 设计语言，我能专注开发，您能专注浏览。", icon: "palette" },
			{ title: "严格把关", description: "每一次提交，每一次发版，都经过严谨的冒烟测试。", icon: "shield-check" }
		],
		socialTitle: "社交链接",
		footer: "Designed by Claude · Logo by WalkerKiller",
		socials: [
			{ name: "GitHub", url: "https://github.com/afoim" },
			{ name: "Twitter", url: "https://x.com/Stelarith_" },
			{ name: "爱发电", url: "https://www.ifdian.net/a/stelarith" },
			{ name: "哔哩哔哩", url: "https://space.bilibili.com/325903362" },
			{ name: "QQ 群", url: "https://qm.qq.com/q/FWqOHlwL2m" },
			{ name: "Telegram", url: "https://t.me/+_07DERp7k1ljYTc1" }
		],
		outboundWhitelist: ["stelarith.com", "localhost"],
		background: { style: "aurora", color1: "#cc785c", color2: "#8b5cf6", color3: "#0ea5e9", intensity: 0.5, speed: 1, particles: true }
	};
}

// 站点公开域名：优先读 .env 的 PUBLIC_SITE_URL / ORIGIN，否则退回请求来源。
// 用于 RSS <link>/<guid>、ClassIsland detailsUri、OG 等绝对 URL，确保指向真实公网域名而非 localhost。
export function getSiteUrl(fallback?: string): string {
	ensureRuntimeEnv();
	const env = process.env.PUBLIC_SITE_URL || process.env.ORIGIN;
	const pick = env || fallback || "";
	return pick.replace(/\/+$/, "");
}

export function getSettings(): SiteSettings {
	const filePath = path.join(CONTENT_DIR, "settings.json");
	if (!fs.existsSync(filePath)) return getDefaultSettings();
	const data = cachedJsonFile<Partial<SiteSettings>>(filePath, {} as Partial<SiteSettings>);
	const defaults = getDefaultSettings();
	return {
		...defaults, ...data,
		socials: data.socials || defaults.socials,
		features: (data.features || defaults.features).map((f: { title: string; description: string; icon?: string }, i: number) => ({
			...f,
			icon: f.icon || defaults.features[i]?.icon || "sparkles"
		})),
		outboundWhitelist: data.outboundWhitelist || defaults.outboundWhitelist,
		background: { ...defaults.background, ...((data as any).background || {}) }
	};
}

export function saveSettings(settings: SiteSettings): void {
	ensureDirs();
	fs.writeFileSync(path.join(CONTENT_DIR, "settings.json"), JSON.stringify(settings, null, 2), "utf-8");
	jsonCache.delete(path.join(CONTENT_DIR, "settings.json"));
}

export interface FriendLink { name: string; url: string; description?: string; avatar?: string; verified?: boolean; category?: string; bottom?: boolean; }

export function getLinks(): FriendLink[] {
	const filePath = path.join(CONTENT_DIR, "links.json");
	if (!fs.existsSync(filePath)) return [];
	try {
		const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
		const raw: FriendLink[] = Array.isArray(data) ? data : data.links || [];
		// 置底（bottom）友链排到最后，其余保持原顺序，实现「榜单后置」展示。
		return [...raw].sort((a, b) => (a.bottom === b.bottom ? 0 : a.bottom ? 1 : -1));
	} catch { return []; }
}

export function saveLinks(links: FriendLink[]): void {
	ensureDirs();
	fs.writeFileSync(path.join(CONTENT_DIR, "links.json"), JSON.stringify({ links }, null, 2), "utf-8");
}

export interface Comment { id: string; target: string; name: string; content: string; createdAt: string; approved: boolean; parentId?: string; author?: string; }

const COMMENTS_FILE = path.join(CONTENT_DIR, "comments.json");

export function getComments(target?: string): Comment[] {
	ensureDirs();
	if (!fs.existsSync(COMMENTS_FILE)) return [];
	let comments: Comment[] = [];
	try {
		const data = JSON.parse(fs.readFileSync(COMMENTS_FILE, "utf-8"));
		comments = Array.isArray(data) ? data : data.comments || [];
	} catch { return []; }
	return target ? comments.filter(c => c.target === target) : comments;
}

export function addComment(comment: Omit<Comment, "id" | "createdAt">): Comment {
	ensureDirs();
	const comments = getComments();
	const nc: Comment = { ...comment, id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36), createdAt: new Date().toISOString() };
	comments.push(nc);
	fs.writeFileSync(COMMENTS_FILE, JSON.stringify({ comments }, null, 2), "utf-8");
	return nc;
}

export function deleteComment(id: string): boolean {
	const comments = getComments();
	const rest = comments.filter(c => c.id !== id);
	if (rest.length === comments.length) return false;
	fs.writeFileSync(COMMENTS_FILE, JSON.stringify({ comments: rest }, null, 2), "utf-8");
	return true;
}

export function toggleCommentApproval(id: string): boolean {
	const comments = getComments();
	const c = comments.find(x => x.id === id);
	if (!c) return false;
	c.approved = !c.approved;
	fs.writeFileSync(COMMENTS_FILE, JSON.stringify({ comments }, null, 2), "utf-8");
	return true;
}

export interface LinkApplication { id: string; name: string; url: string; description?: string; email?: string; status: "pending" | "approved" | "rejected"; verified?: boolean; createdAt: string; }

const LINK_APPS_FILE = path.join(CONTENT_DIR, "link-applications.json");

export function getLinkApplications(status?: string): LinkApplication[] {
	ensureDirs();
	if (!fs.existsSync(LINK_APPS_FILE)) return [];
	let apps: LinkApplication[] = [];
	try {
		const data = JSON.parse(fs.readFileSync(LINK_APPS_FILE, "utf-8"));
		apps = Array.isArray(data) ? data : data.applications || [];
	} catch { return []; }
	return status ? apps.filter(a => a.status === status) : apps.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function addLinkApplication(app: { name: string; url: string; description?: string; email?: string; verified?: boolean }): LinkApplication {
	ensureDirs();
	const apps = getLinkApplications();
	const na: LinkApplication = { ...app, id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36), status: "pending", verified: app.verified || false, createdAt: new Date().toISOString() };
	apps.push(na);
	fs.writeFileSync(LINK_APPS_FILE, JSON.stringify({ applications: apps }, null, 2), "utf-8");
	return na;
}

export function setLinkApplicationStatus(id: string, status: "approved" | "rejected", verified?: boolean): LinkApplication | null {
	const apps = getLinkApplications();
	const app = apps.find(a => a.id === id);
	if (!app) return null;
	app.status = status;
	if (verified !== undefined) app.verified = verified;
	fs.writeFileSync(LINK_APPS_FILE, JSON.stringify({ applications: apps }, null, 2), "utf-8");
	if (status === "approved") {
		const links = getLinks();
		if (!links.some(l => l.url === app.url)) { links.push({ name: app.name, url: app.url, description: app.description, verified: app.verified }); saveLinks(links); }
	}
	return app;
}

export interface NavItem { title: string; url: string; icon?: string; external?: boolean; }
export interface NavConfig { workspace: NavItem[]; more: NavItem[]; bottom: NavItem[]; }

// ───────────────────────────────────────────────────────────────────────────
// 通用：把“一个 JSON 数组文件”当作一张小表读写（UGC 类实体共用此模式）
// ───────────────────────────────────────────────────────────────────────────
function readJsonArray<T>(filePath: string): T[] {
	ensureDirs();
	if (!fs.existsSync(filePath)) return [];
	const data = cachedJsonFile<any>(filePath, null);
	if (data == null) return [];
	return Array.isArray(data) ? data : data.items || [];
}
function writeJsonArray<T>(filePath: string, items: T[]): void {
	ensureDirs();
	fs.writeFileSync(filePath, JSON.stringify({ items: items }, null, 2), "utf-8");
	// 整文件重写 → mtime 变化，但立刻清掉缓存，规避亚秒级分辨率窗口。
	jsonCache.delete(filePath);
}
function genId(prefix: string): string {
	return prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ── 公告 ────────────────────────────────────────────────────────────────────
export type AnnouncementLevel = "info" | "success" | "warning" | "danger";
export interface Announcement {
	id: string;
	title: string;
	content: string;
	level: AnnouncementLevel;
	status: "published" | "draft" | "archived";
	pinned?: boolean;
	createdAt: string;
	updatedAt: string;
	startsAt?: string;
	endsAt?: string;
}
const ANNOUNCEMENTS_FILE = path.join(CONTENT_DIR, "announcements.json");

export function getAnnouncements(opts?: { activeOnly?: boolean }): Announcement[] {
	const all = readJsonArray<Announcement>(ANNOUNCEMENTS_FILE).sort((a, b) => {
		if (a.pinned && !b.pinned) return -1;
		if (!a.pinned && b.pinned) return 1;
		return b.createdAt.localeCompare(a.createdAt);
	});
	if (!opts?.activeOnly) return all;
	const now = new Date().toISOString();
	return all.filter(a => {
		if (a.status !== "published") return false;
		if (a.startsAt && a.startsAt > now) return false;
		if (a.endsAt && a.endsAt < now) return false;
		return true;
	});
}
export function addAnnouncement(input: Omit<Announcement, "id" | "createdAt" | "updatedAt">): Announcement {
	const items = readJsonArray<Announcement>(ANNOUNCEMENTS_FILE);
	const now = new Date().toISOString();
	const item: Announcement = { ...input, id: genId("ann"), createdAt: now, updatedAt: now };
	items.push(item);
	writeJsonArray(ANNOUNCEMENTS_FILE, items);
	return item;
}
export function updateAnnouncement(id: string, patch: Partial<Announcement>): Announcement | null {
	const items = readJsonArray<Announcement>(ANNOUNCEMENTS_FILE);
	const idx = items.findIndex(a => a.id === id);
	if (idx < 0) return null;
	items[idx] = { ...items[idx], ...patch, id, updatedAt: new Date().toISOString() };
	writeJsonArray(ANNOUNCEMENTS_FILE, items);
	return items[idx];
}
export function deleteAnnouncement(id: string): boolean {
	const items = readJsonArray<Announcement>(ANNOUNCEMENTS_FILE);
	const rest = items.filter(a => a.id !== id);
	if (rest.length === items.length) return false;
	writeJsonArray(ANNOUNCEMENTS_FILE, rest);
	return true;
}

// ── 反馈 / Issue（类 GitHub） ────────────────────────────────────────────────
export type FeedbackStatus = "open" | "planned" | "in_progress" | "closed";
export interface FeedbackReply {
	id: string;
	author: string;
	authorRole?: string;
	content: string;
	createdAt: string;
}
export interface Feedback {
	id: string;
	title: string;
	content: string;
	author: string;
	authorRole?: string;
	status: FeedbackStatus;
	labels: string[];
	replies: FeedbackReply[];
	createdAt: string;
	updatedAt: string;
}
const FEEDBACK_FILE = path.join(CONTENT_DIR, "feedback.json");

export function getFeedback(opts?: { status?: FeedbackStatus }): Feedback[] {
	let items = readJsonArray<Feedback>(FEEDBACK_FILE).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	if (opts?.status) items = items.filter(f => f.status === opts.status);
	return items;
}
export function getFeedbackById(id: string): Feedback | null {
	return readJsonArray<Feedback>(FEEDBACK_FILE).find(f => f.id === id) || null;
}
export function addFeedback(input: { title: string; content: string; author: string; authorRole?: string; labels?: string[] }): Feedback {
	const items = readJsonArray<Feedback>(FEEDBACK_FILE);
	const now = new Date().toISOString();
	const item: Feedback = {
		id: genId("fb"),
		title: input.title,
		content: input.content,
		author: input.author,
		authorRole: input.authorRole,
		status: "open",
		labels: input.labels || [],
		replies: [],
		createdAt: now,
		updatedAt: now
	};
	items.push(item);
	writeJsonArray(FEEDBACK_FILE, items);
	return item;
}
export function setFeedbackStatus(id: string, status: FeedbackStatus): Feedback | null {
	const items = readJsonArray<Feedback>(FEEDBACK_FILE);
	const f = items.find(x => x.id === id);
	if (!f) return null;
	f.status = status;
	f.updatedAt = new Date().toISOString();
	writeJsonArray(FEEDBACK_FILE, items);
	return f;
}
export function addFeedbackReply(id: string, reply: { author: string; authorRole?: string; content: string }): Feedback | null {
	const items = readJsonArray<Feedback>(FEEDBACK_FILE);
	const f = items.find(x => x.id === id);
	if (!f) return null;
	f.replies.push({ id: genId("r"), author: reply.author, authorRole: reply.authorRole, content: reply.content, createdAt: new Date().toISOString() });
	f.updatedAt = new Date().toISOString();
	writeJsonArray(FEEDBACK_FILE, items);
	return f;
}
export function deleteFeedback(id: string): boolean {
	const items = readJsonArray<Feedback>(FEEDBACK_FILE);
	const rest = items.filter(f => f.id !== id);
	if (rest.length === items.length) return false;
	writeJsonArray(FEEDBACK_FILE, rest);
	return true;
}

const NAV_FILE = path.join(CONTENT_DIR, "nav.json");

export function getNav(): NavConfig {
	ensureDirs();
	const defaults: NavConfig = {
		workspace: [
			{ title: "首页", url: "/" }, { title: "博客", url: "/posts" }, { title: "项目", url: "/projects" }, { title: "教程", url: "/docs" }, { title: "页面", url: "/pages" }
		],
		more: [],
		bottom: [{ title: "管理后台", url: "/admin" }]
	};
	if (!fs.existsSync(NAV_FILE)) return defaults;
	const data = cachedJsonFile<Partial<NavConfig>>(NAV_FILE, {} as Partial<NavConfig>);
	return {
		workspace: data.workspace || defaults.workspace,
		more: data.more || defaults.more,
		bottom: data.bottom || defaults.bottom
	};
}

export function saveNav(nav: NavConfig): void {
	ensureDirs();
	fs.writeFileSync(NAV_FILE, JSON.stringify(nav, null, 2), "utf-8");
	jsonCache.delete(NAV_FILE);
}

// ───────────────────────────────────────────────────────────────────────────
// 批次一：流量统计 / 作者 / 项目申请 / 文档纠错
// ───────────────────────────────────────────────────────────────────────────

// ── 流量统计 ────────────────────────────────────────────────────────────────
const STATS_FILE = path.join(CONTENT_DIR, "stats.json");
export interface StatsEntry { total: number; daily: Record<string, number>; }
export type StatsData = Record<string, StatsEntry>;

export function getStats(): StatsData {
	ensureDirs();
	if (!fs.existsSync(STATS_FILE)) return {};
	return cachedJsonFile<StatsData>(STATS_FILE, {});
}

/** 记录一次 PV。客户端用 sessionStorage 做“同 tab 同日只发一次”，服务端只负责累加。 */
export function recordView(target: string): number {
	ensureDirs();
	const stats = getStats();
	const today = new Date().toISOString().slice(0, 10);
	const entry: StatsEntry = stats[target] || { total: 0, daily: {} };
	entry.total += 1;
	entry.daily[today] = (entry.daily[today] || 0) + 1;
	stats[target] = entry;
	fs.writeFileSync(STATS_FILE, JSON.stringify(stats), "utf-8");
	// 计数写后立刻清缓存，避免下一读命中旧 mtime（亚秒窗口）而漏算。
	jsonCache.delete(STATS_FILE);
	return entry.total;
}

/** 近 N 日全站 PV 汇总（含每日序列），供后台仪表盘。 */
export function getStatsSummary(days = 7): { total: number; today: number; daily: { date: string; pv: number }[] } {
	const stats = getStats();
	let total = 0;
	for (const key of Object.keys(stats)) total += stats[key].total || 0;
	const daily: { date: string; pv: number }[] = [];
	const now = new Date();
	for (let i = days - 1; i >= 0; i--) {
		const d = new Date(now);
		d.setDate(d.getDate() - i);
		const ds = d.toISOString().slice(0, 10);
		let pv = 0;
		for (const key of Object.keys(stats)) pv += stats[key].daily?.[ds] || 0;
		daily.push({ date: ds, pv });
	}
	const todayStr = now.toISOString().slice(0, 10);
	let todayPv = 0;
	for (const key of Object.keys(stats)) todayPv += stats[key].daily?.[todayStr] || 0;
	return { total, today: todayPv, daily };
}

// ── 作者公开资料 + 其内容 ──────────────────────────────────────────────────
const USERS_FILE = path.join(CONTENT_DIR, "users.json");
export interface PublicUserProfile { username: string; displayName: string; role: string; bio?: string; createdAt: string; }

export function getUserPublic(username: string): PublicUserProfile | null {
	// 真实账号已迁到 SQLite（stelarith.db），优先从这里取。
	const u = getSqlUser(username);
	if (u) {
		return { username: u.username, displayName: u.displayName, role: u.role, bio: u.bio, createdAt: u.createdAt };
	}
	// 回退：兼容尚未迁移进 SQLite 的遗留 users.json 记录。
	ensureDirs();
	if (!fs.existsSync(USERS_FILE)) return null;
	try {
		const users: any[] = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8")).users || [];
		const legacy = users.find(x => x.username === username);
		if (!legacy) return null;
		return { username: legacy.username, displayName: legacy.displayName, role: legacy.role, bio: legacy.bio, createdAt: legacy.createdAt };
	} catch { return null; }
}

/** 按 owner/author 聚合某用户发布的已发布内容（含 posts/projects/docs/pages）。 */
export function getAuthorContent(username: string): { posts: any[]; projects: any[]; docs: any[]; pages: any[] } {
	const match = (it: ContentItem) => it.status === "published" && (it.owner === username || (it as any).author === username);
	const posts = listItems("posts").filter(match).map(toSummary);
	const projects = listItems("projects").filter(match).map(toSummary);
	const docs = listItems("docs").filter(match).map(toSummary);
	const pages = listItems("pages").filter(match).map(toSummary);
	return { posts, projects, docs, pages };
}

// ── 项目专页申请 ─────────────────────────────────────────────────────────────
export interface ProjectApplication {
	id: string;
	name: string;
	summary: string;
	repo?: string;
	website?: string;
	category?: string;
	owner: string;
	status: "pending" | "approved" | "rejected";
	createdAt: string;
}
const PROJECT_APPS_FILE = path.join(CONTENT_DIR, "project-applications.json");

export function getProjectApplications(status?: string): ProjectApplication[] {
	const all = readJsonArray<ProjectApplication>(PROJECT_APPS_FILE).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	return status ? all.filter(a => a.status === status) : all;
}
export function addProjectApplication(input: { name: string; summary: string; repo?: string; website?: string; category?: string; owner: string }): ProjectApplication {
	const items = readJsonArray<ProjectApplication>(PROJECT_APPS_FILE);
	const item: ProjectApplication = { ...input, id: genId("pa"), status: "pending", createdAt: new Date().toISOString() };
	items.push(item);
	writeJsonArray(PROJECT_APPS_FILE, items);
	return item;
}
export function setProjectApplicationStatus(id: string, status: "approved" | "rejected", makePage = false): ProjectApplication | null {
	const items = readJsonArray<ProjectApplication>(PROJECT_APPS_FILE);
	const app = items.find(a => a.id === id);
	if (!app) return null;
	app.status = status;
	writeJsonArray(PROJECT_APPS_FILE, items);
	// 通过后 optionally 生成软件专页（草稿态，管理员再丰富）
	if (status === "approved" && makePage) {
		saveItem("projects", {
			title: app.name,
			body: app.summary,
			status: "published",
			category: app.category,
			owner: app.owner,
			excerpt: app.summary.slice(0, 120)
		});
	}
	return app;
}

// ── 文档纠错（用户贡献） ─────────────────────────────────────────────────────
export interface DocCorrection {
	id: string;
	docSlug: string;
	author: string;
	section?: string;
	original?: string;
	suggestion: string;
	note?: string;
	status: "pending" | "approved" | "rejected";
	createdAt: string;
}
const DOC_CORRECTIONS_FILE = path.join(CONTENT_DIR, "doc-corrections.json");

export function getDocCorrections(status?: string): DocCorrection[] {
	const all = readJsonArray<DocCorrection>(DOC_CORRECTIONS_FILE).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	return status ? all.filter(c => c.status === status) : all;
}
export function addDocCorrection(input: { docSlug: string; author: string; section?: string; original?: string; suggestion: string; note?: string }): DocCorrection {
	const items = readJsonArray<DocCorrection>(DOC_CORRECTIONS_FILE);
	const item: DocCorrection = { ...input, id: genId("dc"), status: "pending", createdAt: new Date().toISOString() };
	items.push(item);
	writeJsonArray(DOC_CORRECTIONS_FILE, items);
	return item;
}
export function setDocCorrectionStatus(id: string, status: "approved" | "rejected"): DocCorrection | null {
	const items = readJsonArray<DocCorrection>(DOC_CORRECTIONS_FILE);
	const c = items.find(x => x.id === id);
	if (!c) return null;
	c.status = status;
	writeJsonArray(DOC_CORRECTIONS_FILE, items);
	return c;
}

// ── 论坛（频道 / 主题帖 / 回复）─────────────────────────────────────────
export interface ForumChannel {
	id: string;
	name: string;
	slug: string;
	description?: string;
	owner: string;
	createdAt: string;
	pinned?: boolean;
	status: "published" | "hidden";
}
export interface ForumThread {
	id: string;
	channelId: string;
	title: string;
	body: string;
	author: string;
	authorRole: string;
	createdAt: string;
	status: "published" | "pending" | "rejected" | "locked";
	pinned?: boolean;
	views: number;
	lastReplyAt?: string;
}
export interface ForumReply {
	id: string;
	threadId: string;
	author: string;
	authorRole: string;
	content: string;
	createdAt: string;
	status: "published" | "deleted";
}
const FORUM_CH_FILE = path.join(CONTENT_DIR, "forum-channels.json");
const FORUM_TH_FILE = path.join(CONTENT_DIR, "forum-threads.json");
const FORUM_RP_FILE = path.join(CONTENT_DIR, "forum-replies.json");

function slugifyForum(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || genId("ch");
}

export function getForumChannels(): ForumChannel[] {
	const all = readJsonArray<ForumChannel>(FORUM_CH_FILE);
	return all.filter(c => c.status === "published").sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.createdAt.localeCompare(a.createdAt));
}
export function getForumChannel(slug: string): ForumChannel | null {
	return readJsonArray<ForumChannel>(FORUM_CH_FILE).find(c => c.slug === slug) || null;
}
export function addForumChannel(input: { name: string; description?: string; owner: string }): ForumChannel {
	const items = readJsonArray<ForumChannel>(FORUM_CH_FILE);
	const ch: ForumChannel = {
		id: genId("fc"),
		name: input.name,
		slug: slugifyForum(input.name),
		description: input.description,
		owner: input.owner,
		createdAt: new Date().toISOString(),
		status: "published"
	};
	items.push(ch);
	writeJsonArray(FORUM_CH_FILE, items);
	return ch;
}

/** 公开可见 = published 或 locked；pending/rejected 仅后台可见。 */
export function getForumThreads(channelId?: string, includeUnpublished = false): ForumThread[] {
	const all = readJsonArray<ForumThread>(FORUM_TH_FILE);
	const filtered = channelId ? all.filter(t => t.channelId === channelId) : all;
	const vis = includeUnpublished ? filtered : filtered.filter(t => t.status === "published" || t.status === "locked");
	return vis.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.lastReplyAt || b.createdAt).localeCompare(a.lastReplyAt || a.createdAt));
}
export function getForumThread(id: string): { thread: ForumThread | null; replies: ForumReply[] } {
	const thread = readJsonArray<ForumThread>(FORUM_TH_FILE).find(t => t.id === id) || null;
	if (!thread) return { thread: null, replies: [] };
	const replies = readJsonArray<ForumReply>(FORUM_RP_FILE).filter(r => r.threadId === id && r.status === "published").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	return { thread, replies };
}
export function addForumThread(input: { channelId: string; title: string; body: string; author: string; authorRole: string }): ForumThread {
	const items = readJsonArray<ForumThread>(FORUM_TH_FILE);
	const t: ForumThread = {
		id: genId("ft"),
		channelId: input.channelId,
		title: input.title,
		body: input.body,
		author: input.author,
		authorRole: input.authorRole,
		createdAt: new Date().toISOString(),
		status: "published",
		views: 0
	};
	items.push(t);
	writeJsonArray(FORUM_TH_FILE, items);
	return t;
}
export function addForumReply(input: { threadId: string; author: string; authorRole: string; content: string }): ForumReply {
	const items = readJsonArray<ForumReply>(FORUM_RP_FILE);
	const r: ForumReply = {
		id: genId("fr"),
		threadId: input.threadId,
		author: input.author,
		authorRole: input.authorRole,
		content: input.content,
		createdAt: new Date().toISOString(),
		status: "published"
	};
	items.push(r);
	writeJsonArray(FORUM_RP_FILE, items);
	const threads = readJsonArray<ForumThread>(FORUM_TH_FILE);
	const t = threads.find(x => x.id === input.threadId);
	if (t) { t.lastReplyAt = r.createdAt; writeJsonArray(FORUM_TH_FILE, threads); }
	return r;
}
export function setForumThreadStatus(id: string, status: ForumThread["status"]): ForumThread | null {
	const items = readJsonArray<ForumThread>(FORUM_TH_FILE);
	const t = items.find(x => x.id === id);
	if (!t) return null;
	t.status = status;
	writeJsonArray(FORUM_TH_FILE, items);
	return t;
}
export function incForumThreadViews(id: string): void {
	const items = readJsonArray<ForumThread>(FORUM_TH_FILE);
	const t = items.find(x => x.id === id);
	if (t) { t.views = (t.views || 0) + 1; writeJsonArray(FORUM_TH_FILE, items); }
}
export function deleteForumThread(id: string): void {
	let items = readJsonArray<ForumThread>(FORUM_TH_FILE);
	items = items.filter(x => x.id !== id);
	writeJsonArray(FORUM_TH_FILE, items);
	let replies = readJsonArray<ForumReply>(FORUM_RP_FILE);
	replies = replies.filter(r => r.threadId !== id);
	writeJsonArray(FORUM_RP_FILE, replies);
}
export function pinForumThread(id: string, pinned: boolean): ForumThread | null {
	const items = readJsonArray<ForumThread>(FORUM_TH_FILE);
	const t = items.find(x => x.id === id);
	if (!t) return null;
	t.pinned = pinned;
	writeJsonArray(FORUM_TH_FILE, items);
	return t;
}

// ───────────────────────────────────────────────────────────────────────────
// 订阅源 / RSS / ClassIsland 播报配置
// 后台可管理「要聚合的知名新闻源」与「是否把公告/文章/新闻推送到 ClassIsland」。
// 源数据落 content/feed-config.json，与既有 items 存储模式保持一致。
// ───────────────────────────────────────────────────────────────────────────
export interface FeedSource {
	id: string;
	name: string;
	url: string;
	category: string;
	enabled: boolean;
	maxItems: number;
}

export interface FeedSettings {
	includeAnnouncementsInBroadcast: boolean;
	includePostsInBroadcast: boolean;
	includeNewsInBroadcast: boolean;
	maxPostsInBroadcast: number;
	maxNewsItems: number;
	newsWindowDays: number;
	broadcastSeverity: number; // 0=一般 1=重要 2=紧急（ClassIsland Severity 枚举）
}

export interface FeedConfig {
	sources: FeedSource[];
	settings: FeedSettings;
}

const DEFAULT_FEED_SOURCES: FeedSource[] = [
	{ id: "sspai", name: "少数派", url: "https://sspai.com/feed", category: "效率/科技", enabled: true, maxItems: 12 },
	{ id: "ruanyifeng", name: "阮一峰的网络日志", url: "https://www.ruanyifeng.com/blog/atom.xml", category: "开发", enabled: true, maxItems: 10 },
	{ id: "v2ex", name: "V2EX 最热", url: "https://www.v2ex.com/index.xml", category: "社区", enabled: true, maxItems: 12 },
	{ id: "hn", name: "Hacker News", url: "https://hnrss.org/frontpage", category: "开发/综合", enabled: true, maxItems: 15 },
	{ id: "github-blog", name: "GitHub Blog", url: "https://github.blog/feed/", category: "开发", enabled: true, maxItems: 10 },
	{ id: "meituan", name: "美团技术团队", url: "https://tech.meituan.com/feed/", category: "开发", enabled: false, maxItems: 10 },
	{ id: "coolshell", name: "酷壳 CoolShell", url: "https://coolshell.cn/feed", category: "开发", enabled: false, maxItems: 10 },
	{ id: "36kr", name: "36氪", url: "https://36kr.com/feed", category: "创投", enabled: false, maxItems: 12 }
];

const DEFAULT_FEED_SETTINGS: FeedSettings = {
	includeAnnouncementsInBroadcast: true,
	includePostsInBroadcast: true,
	includeNewsInBroadcast: true,
	maxPostsInBroadcast: 5,
	maxNewsItems: 10,
	newsWindowDays: 7,
	broadcastSeverity: 0
};

const FEED_CONFIG_FILE = path.join(CONTENT_DIR, "feed-config.json");

export function getFeedConfig(): FeedConfig {
	ensureDirs();
	if (!fs.existsSync(FEED_CONFIG_FILE)) {
		return { sources: DEFAULT_FEED_SOURCES, settings: { ...DEFAULT_FEED_SETTINGS } };
	}
	try {
		const data = JSON.parse(fs.readFileSync(FEED_CONFIG_FILE, "utf-8"));
		const sources = Array.isArray(data.sources) && data.sources.length ? data.sources.map(normalizeSource) : DEFAULT_FEED_SOURCES;
		const settings = { ...DEFAULT_FEED_SETTINGS, ...(data.settings || {}) };
		settings.broadcastSeverity = clampSeverity(settings.broadcastSeverity);
		return { sources, settings };
	} catch {
		return { sources: DEFAULT_FEED_SOURCES, settings: { ...DEFAULT_FEED_SETTINGS } };
	}
}

export function saveFeedConfig(cfg: Partial<FeedConfig>): FeedConfig {
	ensureDirs();
	const prev = getFeedConfig();
	const sources = Array.isArray(cfg.sources) ? cfg.sources.map(normalizeSource) : prev.sources;
	const settings: FeedSettings = { ...DEFAULT_FEED_SETTINGS, ...(prev.settings || {}), ...(cfg.settings || {}) };
	settings.broadcastSeverity = clampSeverity(settings.broadcastSeverity);
	settings.maxNewsItems = Math.max(0, Math.min(50, Math.floor(settings.maxNewsItems) || 0));
	settings.maxPostsInBroadcast = Math.max(0, Math.min(50, Math.floor(settings.maxPostsInBroadcast) || 0));
	settings.newsWindowDays = Math.max(1, Math.min(60, Math.floor(settings.newsWindowDays) || 1));
	const next: FeedConfig = { sources, settings };
	fs.writeFileSync(FEED_CONFIG_FILE, JSON.stringify(next, null, 2), "utf-8");
	return next;
}

function clampSeverity(v: any): number {
	const n = Number(v);
	return [0, 1, 2].includes(n) ? n : 0;
}

function normalizeSource(s: any): FeedSource {
	return {
		id: typeof s.id === "string" && s.id ? s.id : "src-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
		name: String(s.name || "未命名源"),
		url: String(s.url || ""),
		category: String(s.category || "综合"),
		enabled: !!s.enabled,
		maxItems: Math.max(1, Math.min(50, Number(s.maxItems) || 10))
	};
}
