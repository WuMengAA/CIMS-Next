import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getVersions, getVersionRaw, restoreVersion, listItems, getItem, saveItem } from "$lib/server/content-store.js";
import { verifyToken } from "$lib/server/auth.js";
import { can } from "$lib/permissions.js";

const SECTIONS = ["posts", "projects", "docs", "pages"] as const;

export const GET: RequestHandler = async ({ url }) => {
	const section = url.searchParams.get("section") as (typeof SECTIONS)[number] | null;
	const slug = url.searchParams.get("slug");
	const version = url.searchParams.get("version");
	const archivedOnly = url.searchParams.get("archived") === "1";

	if (archivedOnly) {
		// 已归档条目清单：status=archived 的条目（可能没有版本快照记录）
		const out: { section: string; slug: string; title: string; date: string; updated?: string }[] = [];
		for (const s of SECTIONS) {
			for (const it of listItems(s)) {
				if (it.status === "archived") {
					out.push({ section: s, slug: it.slug, title: it.title, date: it.date, ...(it.updated ? { updated: it.updated } : {}) });
				}
			}
		}
		out.sort((a, b) => (b.updated || b.date).localeCompare(a.updated || a.date));
		return json({ items: out });
	}

	if (!section || !slug) {
		// 全局概览：所有有版本记录的条目
		const out: { section: string; slug: string; title: string; versions: number; latestAt: string }[] = [];
		for (const s of SECTIONS) {
			for (const it of listItems(s)) {
				const vs = getVersions(s, it.slug);
				if (vs.length > 0) {
					out.push({ section: s, slug: it.slug, title: it.title, versions: vs.length, latestAt: vs[vs.length - 1].savedAt });
				}
			}
		}
		out.sort((a, b) => (b.latestAt < a.latestAt ? -1 : 1));
		return json({ items: out });
	}

	if (version) {
		const raw = getVersionRaw(section, slug, version);
		if (raw == null) return json({ error: "版本不存在" }, { status: 404 });
		return json({ raw });
	}

	return json({ versions: getVersions(section, slug) });
};

export const POST: RequestHandler = async ({ request }) => {
	const u = verifyToken(request.headers.get("cookie")?.match(/admin_token=([^;]+)/)?.[1] || "");
	if (!u || !can(u.role, "moderate")) return json({ error: "无权限" }, { status: 403 });
	const body = await request.json();
	const { section, slug, version } = body;

	// 归档 / 取消归档：把条目 status 置为 archived / published。
	// 前台列表只展示 published，归档即从前台与编辑列表隐藏，但文件与版本快照保留。
	if (body.action === "archive" || body.action === "unarchive") {
		if (!SECTIONS.includes(section) || !slug) return json({ error: "参数不完整" }, { status: 400 });
		const item = getItem(section as (typeof SECTIONS)[number], slug);
		if (!item) return json({ error: "条目不存在" }, { status: 404 });
		const next = body.action === "archive" ? "archived" : "published";
		try {
			saveItem(section as (typeof SECTIONS)[number], {
				slug,
				title: item.title,
				body: item.body,
				status: next as "archived" | "published",
				editor: u.username
			});
			return json({ ok: true, status: next });
		} catch (e) {
			console.error("archive action failed:", e);
			return json({ error: "操作失败" }, { status: 500 });
		}
	}

	if (!SECTIONS.includes(section) || !slug || !version) return json({ error: "参数不完整" }, { status: 400 });
	const ok = restoreVersion(section as (typeof SECTIONS)[number], slug, version);
	return ok ? json({ ok: true }) : json({ error: "回滚失败" }, { status: 404 });
};
