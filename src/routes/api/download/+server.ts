/**
 * /api/download —— 统一下载资源聚合端点（2026-10-06）。
 *
 * 把「全站可下载的东西」聚成一份统一清单，供下载中心整合面板与全站搜索消费：
 *   - 项目发行包：project-boards.json 的历史 releases + 云端 ota.json 的当前版
 *     （agent/viewer 最新版经 /api/public/ota 实时取，发版自动跟着变，不在此处另存）
 *   - 上传资源：uploads/ 目录按扩展名分类（图片 / 视频 / 文档 / 应用）
 *
 * 统一条目：
 *   { id, type, title, desc, url, size, date }
 *     type ∈ project | image | video | doc | app
 *
 * 支持查询：
 *   GET /api/download?q=关键词&type=project|image|video|doc|app（可逗号多选）
 *   无 q / 无 type 时返回全量（按日期倒序）。
 * 公开端点（只回公开信息，无令牌）。
 */

import { json } from "@sveltejs/kit";
import { listUploads } from "$lib/server/content-store.js";
import { getBoards } from "$lib/server/project-board.js";
import { fetchPublished, humanSize } from "$lib/server/downloads.js";

/** 扩展名 → 资源类型 */
const KIND_ORDER: Record<string, string> = {
	jpg: "image", jpeg: "image", png: "image", gif: "image", webp: "image", svg: "image", bmp: "image", ico: "image",
	mp4: "video", webm: "video", mov: "video", mkv: "video", avi: "video", flv: "video",
	pdf: "doc", doc: "doc", docx: "doc", xls: "doc", xlsx: "doc", ppt: "doc", pptx: "doc", txt: "doc", md: "doc",
	exe: "app", msi: "app", zip: "app", "7z": "app", rar: "app", apk: "app", dmg: "app", json: "app", csv: "app"
};
const DEFAULT_KIND = "doc";

function kindOf(filename: string): string {
	const ext = filename.split(".").pop()?.toLowerCase() ?? "";
	return KIND_ORDER[ext] ?? DEFAULT_KIND;
}

/** 聚合项目发行包（历史 releases + 云端当前版） */
async function collectProjectReleases() {
	const items: { id: string; type: string; title: string; desc: string; url: string; size: number; date: string }[] = [];

	// 1) 本地展板历史 releases（v1.0.x 等云端没有的归档）
	for (const b of getBoards()) {
		for (const r of b.releases ?? []) {
			if (!r?.id || !r?.name) continue;
			items.push({
				id: `${b.slug}__${r.id}`,
				type: "project",
				title: r.name || r.tag,
				desc: r.notes || b.tagline || b.slug,
				url: r.url || "",
				size: r.size || 0,
				date: (r.createdAt || "").slice(0, 10)
			});
		}
	}

	// 2) 云端当前版（agent/viewer），发版自动跟着变
	const products = [
		{ id: "agent", title: "星集控被控端（教室机）" },
		{ id: "viewer", title: "星集控管理端（老师机）" }
	];
	await Promise.all(products.map(async (p) => {
		const st = await fetchPublished(p.id as "agent" | "viewer");
		if (st.published) {
			items.push({
				id: `cloud__${p.id}__${st.latest.version}`,
				type: "project",
				title: `${p.title} ${st.latest.version}`,
				desc: st.latest.notes || "",
				url: st.latest.url,
				size: st.latest.size,
				date: new Date().toISOString().slice(0, 10)
			});
		}
	}));

	return items;
}

/** 聚合上传资源（按扩展名分类） */
function collectUploads() {
	return listUploads().filter((u) => u.size > 0).map((u) => ({
		id: `up__${u.filename}`,
		type: kindOf(u.filename),
		title: u.filename,
		desc: `${u.kind.toUpperCase()} 文件`,
		url: u.url,
		size: u.size,
		date: u.date
	}));
}

export async function GET({ url }: { url: URL }) {
	const q = (url.searchParams.get("q") || "").trim().slice(0, 60).toLowerCase();
	const rawType = url.searchParams.get("type") || "";
	const types = rawType.split(",").map((s) => s.trim()).filter(Boolean);

	const [projectReleases, uploads] = await Promise.all([collectProjectReleases(), Promise.resolve(collectUploads())]);
	let items = [...projectReleases, ...uploads];

	if (q) {
		items = items.filter((i) => i.title.toLowerCase().includes(q) || i.desc.toLowerCase().includes(q));
	}
	if (types.length) {
		items = items.filter((i) => types.includes(i.type));
	}

	items.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));

	return json({
		ok: true,
		total: items.length,
		items: items.map((i) => ({ ...i, sizeText: humanSize(i.size) })),
		types: { project: "项目发行", image: "图片", video: "视频", doc: "文档", app: "应用" }
	});
}
