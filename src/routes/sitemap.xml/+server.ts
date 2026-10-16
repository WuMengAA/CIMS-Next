import { listItems, getSiteUrl } from "$lib/server/content-store.js";
import type { RequestHandler } from "./$types";

/** 有公开可索引内容的静态路由（不含 /admin、/account、/search、占位页等）。 */
const STATIC_PATHS = [
	"/",
	"/changelog",
	"/download",
	"/pulse",
	"/projects",
	"/docs",
	"/pages",
	"/links",
	"/news",
	"/archive",
	"/archives",
	"/announcements",
	"/feedback",
	"/forum",
	"/tools",
	"/tools/cover-generator",
	"/voicehub",
	"/voicehub/help"
];

const DETAIL_SECTIONS = [
	{ section: "projects" as const, prefix: "/projects/" },
	{ section: "docs" as const, prefix: "/docs/" },
	{ section: "pages" as const, prefix: "/pages/" }
];

function esc(s: unknown): string {
	return String(s)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/**
 * 归一化 lastmod 到 W3C 的 YYYY-MM-DD。
 * 注意：frontmatter 里的 `date:` 会被 js-yaml 直接解析成 **Date 对象**（不是字符串），
 * 早期版本直接把 Date 丢给 esc() 会炸在 `s.replace is not a function`，故这里统一兜底。
 */
function fmtDate(v: unknown): string | undefined {
	if (!v) return undefined;
	const d = v instanceof Date ? v : new Date(String(v));
	return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

function urlTag(loc: string, lastmod?: string, priority?: string): string {
	return [
		"  <url>",
		`    <loc>${esc(loc)}</loc>`,
		lastmod ? `    <lastmod>${esc(lastmod)}</lastmod>` : "",
		priority ? `    <priority>${priority}</priority>` : "",
		"  </url>"
	]
		.filter(Boolean)
		.join("\n");
}

export const GET: RequestHandler = async () => {
	const siteBase = getSiteUrl().replace(/\/$/, "");
	const today = new Date().toISOString().slice(0, 10);
	const entries: string[] = [];

	// voicehub 区块的 SEO 首选域名由用户指定为 voicehub.245959623.xyz，
	// 与校站主域名 www 区分，避免多域名重复收录 / 规范地址冲突。
	const VOICEHUB_SEO_BASE = "https://voicehub.245959623.xyz";
	const voicehubPaths = new Set(["/voicehub", "/voicehub/help"]);
	const baseFor = (p: string) => (voicehubPaths.has(p) ? VOICEHUB_SEO_BASE : siteBase);

	for (const p of STATIC_PATHS) {
		entries.push(urlTag(baseFor(p) + p, today, p === "/" ? "1.0" : "0.6"));
	}

	for (const { section, prefix } of DETAIL_SECTIONS) {
		for (const item of listItems(section)) {
			if (item.status !== "published") continue;
			const lastmod = fmtDate(item.updated) || fmtDate(item.date);
			entries.push(urlTag(siteBase + prefix + item.slug, lastmod, "0.8"));
		}
	}

	const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`;

	return new Response(xml, {
		headers: {
			"Content-Type": "application/xml; charset=utf-8",
			"Cache-Control": "public, max-age=3600, stale-while-revalidate=86400"
		}
	});
};
