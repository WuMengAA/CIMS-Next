/**
 * 项目展板 · 发行文件上传。
 *
 * 复用 content-store 的 uploadFile（含扩展名白名单与 100MB 上限），但**单独开一条路由**
 * 而不是走 /api/media：/api/media 只要求登录，而发行文件属于「内容管理」动作，
 * 必须由 manageContent 门控 —— 否则任何登录用户都能往展板里塞可执行文件。
 */

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getApiUser } from "$lib/server/api-auth.js";
import { can } from "$lib/permissions.js";
import { uploadFile } from "$lib/server/content-store.js";
import fs from "node:fs";
import path from "node:path";
import { UPLOADS_DIR } from "$lib/server/paths.js";

export const POST: RequestHandler = async ({ request }) => {
	const user = await getApiUser(request);
	if (!user) return json({ error: "未登录" }, { status: 401 });
	if (!can(user.role, "manageContent")) return json({ error: "无权上传发行文件" }, { status: 403 });

	const form = await request.formData();
	const file = form.get("file");
	if (!(file instanceof File)) return json({ error: "缺少文件" }, { status: 400 });

	const buffer = Buffer.from(await file.arrayBuffer());
	const result = uploadFile(file.name, buffer);
	if (result.error) return json({ error: result.error }, { status: 400 });

	const stored = path.basename(result.url);
	const size = fs.existsSync(path.join(UPLOADS_DIR, stored)) ? fs.statSync(path.join(UPLOADS_DIR, stored)).size : buffer.length;
	return json({ file: stored, url: result.url, size, originalName: file.name });
};
