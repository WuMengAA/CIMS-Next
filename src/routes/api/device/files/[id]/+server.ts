/**
 * 被控轴 · 下载推送文件（`GET /api/device/files/<file_id>`）
 *
 * `file_push` 指令的下半场：教室端按 file_id 取回文件本体。
 *
 * ⚠️ 与旧实现的两点差异（都是**等价改写**，不是行为变更）：
 *   1. file_id 从 query（`?id=`）改为**路径段** —— 更符合 HTTP 语义，
 *      也避免"忘记带 id 就 404"这类调用歧义；
 *   2. 中文文件名仍按 RFC 5987 双写：`filename`（ASCII 兜底）+ `filename*`（UTF-8 原文）。
 *
 * 来源：旧 `GET /api/console/ext/files?id=<fid>`（设备密钥分支）。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { getFileObject, readFileBytes } from "$lib/server/file-transfer.js";
import { guardDevice } from "$lib/server/guard-device.js";

export function GET(event: RequestEvent) {
	const g = guardDevice(event);
	if ("error" in g) return g.error;

	const fid = String(event.params.id ?? "").trim();
	const obj = fid ? getFileObject(fid) : null;
	if (!obj) return json({ error: "文件不存在或已清理", code: "not_found" }, { status: 404 });

	const bytes = readFileBytes(obj);
	if (!bytes) return json({ error: "文件内容已清理", code: "gone" }, { status: 410 });

	// 中文文件名：filename* 按 RFC 5987 编码；filename 兜底 ASCII。
	const asciiName = obj.name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
	return new Response(new Uint8Array(bytes), {
		status: 200,
		headers: {
			"content-type": "application/octet-stream",
			"content-length": String(bytes.length),
			"content-disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(obj.name)}`
		}
	});
}
