/**
 * 项目展板 · 发行下载跳转。
 *
 * 为什么不让前端直接指 /uploads/xxx：需要**计数**。下载次数只有经过服务端
 * 才能统计，且顺便做一次「该文件确实存在于 uploads/」的校验，避免死链。
 *
 * 站内发行 → 计数后 302 到 /uploads/<file>；GitHub 来源的发行 → 直接 302 到外链，
 * 不计数（那些数字以 GitHub 的 download_count 为准）。
 */

import { redirect, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getBoard, bumpDownload } from "$lib/server/project-board.js";
import fs from "node:fs";
import path from "node:path";
import { UPLOADS_DIR } from "$lib/server/paths.js";

export const GET: RequestHandler = async ({ url }) => {
	const slug = url.searchParams.get("slug") ?? "";
	const id = url.searchParams.get("id") ?? "";
	if (!slug || !id) throw error(400, "slug 与 id 必填");

	const board = getBoard(slug);
	const rel = board?.releases.find((r) => r.id === id);
	if (!rel) throw error(404, "发行记录不存在");

	// GitHub 来源：外链直跳，不计数
	if (rel.source === "github") {
		if (!rel.url) throw error(404, "该发行没有可用下载地址");
		throw redirect(302, rel.url);
	}

	const file = path.basename(rel.file || rel.url.replace(/^\/uploads\//, ""));
	if (!file) throw error(404, "该发行没有关联文件");
	const abs = path.join(UPLOADS_DIR, file);
	if (!fs.existsSync(abs)) throw error(404, "文件已被移除");

	bumpDownload(slug, id);
	throw redirect(302, `/uploads/${encodeURIComponent(file)}`);
};
