import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import markdownIt from "markdown-it";
import markdownItAnchor from "markdown-it-anchor";
import hljs from "highlight.js";
import katexPlugin from "markdown-it-katex";
import taskLists from "markdown-it-task-lists";
import footnote from "markdown-it-footnote";

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

const sections: Record<string, string> = {
	posts: path.join(CONTENT_DIR, "posts"),
	projects: path.join(CONTENT_DIR, "projects"),
	docs: path.join(CONTENT_DIR, "docs")
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

function ensureDirs() {
	for (const dir of Object.values(sections)) {
		fs.mkdirSync(dir, { recursive: true });
	}
	fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export function listItems(section: "posts" | "projects" | "docs"): ContentItem[] {
	ensureDirs();
	const dir = sections[section];
	if (!fs.existsSync(dir)) return [];
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
	return items.sort((a, b) => {
		if (a.pinned && !b.pinned) return -1;
		if (!a.pinned && b.pinned) return 1;
		if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
		return b.date.localeCompare(a.date);
	});
}

export function getItem(section: "posts" | "projects" | "docs", slug: string): ContentItem | null {
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
		...(data.folder ? { folder: data.folder } : {})
	};
}

export function saveItem(
	section: "posts" | "projects" | "docs",
	item: Partial<ContentItem> & { title: string; body: string }
): ContentItem {
	ensureDirs();
	const slug = item.slug || item.title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "");
	const filePath = path.join(sections[section], slug + ".md");
	const frontmatter: Record<string, unknown> = { title: item.title, date: item.date || new Date().toISOString().slice(0, 10), status: item.status || "published" };
	if (item.category) frontmatter.category = item.category;
	if (item.tags) frontmatter.tags = item.tags;
	if (item.excerpt) frontmatter.excerpt = item.excerpt;
	if (item.cover) frontmatter.cover = item.cover;
	if (item.order !== undefined) frontmatter.order = item.order;
	if (item.pinned !== undefined) frontmatter.pinned = item.pinned;
	if (item.owner) frontmatter.owner = item.owner;
	if (item.folder) frontmatter.folder = item.folder;
	const raw = matter.stringify(item.body, frontmatter);
	fs.writeFileSync(filePath, raw, "utf-8");
	return getItem(section, slug)!;
}

export function deleteItem(section: "posts" | "projects" | "docs", slug: string): boolean {
	ensureDirs();
	const filePath = path.join(sections[section], slug + ".md");
	if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); return true; }
	return false;
}

export function reorderItems(section: "posts" | "projects" | "docs", orderedSlugs: string[]): void {
	ensureDirs();
	for (let index = 0; index < orderedSlugs.length; index++) {
		const item = getItem(section, orderedSlugs[index]);
		if (item) saveItem(section, { slug: item.slug, title: item.title, body: item.body, date: item.date, category: item.category, tags: item.tags, excerpt: item.excerpt, cover: item.cover, status: item.status, order: index, pinned: item.pinned });
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
	// Images render progressively: off-screen content images load lazily
	const html = md
		.render(fixTableBlocks(mdContent))
		.replace(/<img /g, '<img loading="lazy" decoding="async" ');
	const toc: { id: string; text: string; level: number }[] = [];
	const headingRe = /<h([23])\s+id="([^"]*)"[^>]*>([\s\S]*?)<\/h\1>/g;
	let m: RegExpExecArray | null;
	while ((m = headingRe.exec(html)) !== null) {
		const text = m[3].replace(/<[^>]+>/g, "").trim();
		if (text) toc.push({ id: m[2], text, level: parseInt(m[1], 10) });
	}
	const words = mdContent.replace(/[#*`\[\]()!>\-\s]/g, "").length;
	return { html, toc, words };
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

export function getTags(section: "posts" | "projects" | "docs"): string[] {
	const set = new Set<string>();
	for (const it of listItems(section)) for (const t of it.tags || []) set.add(t);
	return [...set].sort();
}

export function getCategories(section: "posts" | "projects" | "docs"): string[] {
	const set = new Set<string>();
	for (const it of listItems(section)) if (it.category) set.add(it.category);
	return [...set].sort();
}

export function getFolders(section: "posts" | "projects" | "docs"): string[] {
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

export function getSettings(): SiteSettings {
	const filePath = path.join(CONTENT_DIR, "settings.json");
	if (!fs.existsSync(filePath)) return getDefaultSettings();
	const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Partial<SiteSettings>;
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
}

export interface FriendLink { name: string; url: string; description?: string; avatar?: string; }

export function getLinks(): FriendLink[] {
	const filePath = path.join(CONTENT_DIR, "links.json");
	if (!fs.existsSync(filePath)) return [];
	try {
		const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
		return Array.isArray(data) ? data : data.links || [];
	} catch { return []; }
}

export function saveLinks(links: FriendLink[]): void {
	ensureDirs();
	fs.writeFileSync(path.join(CONTENT_DIR, "links.json"), JSON.stringify({ links }, null, 2), "utf-8");
}

export interface Comment { id: string; postSlug: string; name: string; content: string; createdAt: string; approved: boolean; parentId?: string; }

const COMMENTS_FILE = path.join(CONTENT_DIR, "comments.json");

export function getComments(postSlug?: string): Comment[] {
	ensureDirs();
	if (!fs.existsSync(COMMENTS_FILE)) return [];
	let comments: Comment[] = [];
	try {
		const data = JSON.parse(fs.readFileSync(COMMENTS_FILE, "utf-8"));
		comments = Array.isArray(data) ? data : data.comments || [];
	} catch { return []; }
	return postSlug ? comments.filter(c => c.postSlug === postSlug) : comments;
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

export interface LinkApplication { id: string; name: string; url: string; description?: string; email?: string; status: "pending" | "approved" | "rejected"; createdAt: string; }

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

export function addLinkApplication(app: { name: string; url: string; description?: string; email?: string }): LinkApplication {
	ensureDirs();
	const apps = getLinkApplications();
	const na: LinkApplication = { ...app, id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36), status: "pending", createdAt: new Date().toISOString() };
	apps.push(na);
	fs.writeFileSync(LINK_APPS_FILE, JSON.stringify({ applications: apps }, null, 2), "utf-8");
	return na;
}

export function setLinkApplicationStatus(id: string, status: "approved" | "rejected"): LinkApplication | null {
	const apps = getLinkApplications();
	const app = apps.find(a => a.id === id);
	if (!app) return null;
	app.status = status;
	fs.writeFileSync(LINK_APPS_FILE, JSON.stringify({ applications: apps }, null, 2), "utf-8");
	if (status === "approved") {
		const links = getLinks();
		if (!links.some(l => l.url === app.url)) { links.push({ name: app.name, url: app.url, description: app.description }); saveLinks(links); }
	}
	return app;
}

export interface NavItem { title: string; url: string; icon?: string; external?: boolean; }
export interface NavConfig { workspace: NavItem[]; more: NavItem[]; bottom: NavItem[]; }

const NAV_FILE = path.join(CONTENT_DIR, "nav.json");

export function getNav(): NavConfig {
	ensureDirs();
	const defaults: NavConfig = {
		workspace: [
			{ title: "首页", url: "/" }, { title: "博客", url: "/posts" }, { title: "项目", url: "/projects" }, { title: "文档", url: "/docs" }
		],
		more: [],
		bottom: [{ title: "管理后台", url: "/admin" }]
	};
	if (!fs.existsSync(NAV_FILE)) return defaults;
	try {
		const data = JSON.parse(fs.readFileSync(NAV_FILE, "utf-8"));
		return { workspace: data.workspace || defaults.workspace, more: data.more || defaults.more, bottom: data.bottom || defaults.bottom };
	} catch { return defaults; }
}

export function saveNav(nav: NavConfig): void {
	ensureDirs();
	fs.writeFileSync(NAV_FILE, JSON.stringify(nav, null, 2), "utf-8");
}
