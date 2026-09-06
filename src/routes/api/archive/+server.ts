import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getVersions, getVersionRaw, restoreVersion, listItems } from "$lib/server/content-store.js";
import { verifyToken } from "$lib/server/auth.js";
import { can } from "$lib/permissions.js";

const SECTIONS = ["posts", "projects", "docs"] as const;

export const GET: RequestHandler = async ({ url }) => {
	const section = url.searchParams.get("section") as (typeof SECTIONS)[number] | null;
	const slug = url.searchParams.get("slug");
	const version = url.searchParams.get("version");

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
	if (!SECTIONS.includes(section) || !slug || !version) return json({ error: "参数不完整" }, { status: 400 });
	const ok = restoreVersion(section as (typeof SECTIONS)[number], slug, version);
	return ok ? json({ ok: true }) : json({ error: "回滚失败" }, { status: 404 });
};
