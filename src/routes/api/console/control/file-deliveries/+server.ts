/**
 * 控制轴 · 传文件回执（`GET /api/console/control/file-deliveries?file=<id>`）
 *
 * **发送方视角**：某次推送后，每台设备收到没有。
 *
 * 可见性：非管理员只能看「在自己范围内班级」的回执，且**文件上传者本身可见自己的记录**。
 *
 * ⚠️ 口径（全项目一致，别在这里另立）：`pending` = 还没回执，**不等于失败**；
 * 超时/无回执**绝不当失败**。这里只返回原始状态，不做"成没成"的结论。
 *
 * 来源：旧 `GET /api/console/ext/file-deliveries`。
 * 对称的被控轴是 `POST /api/device/file-ack`（设备回报 acked/failed）。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { classScopeOf } from "$lib/server/class-scope.js";
import { getFileObject, listDeliveries } from "$lib/server/file-transfer.js";
import { guardControl } from "$lib/server/guard-control.js";

export async function GET(event: RequestEvent) {
	const g = await guardControl(event);
	if ("error" in g) return g.error;
	const u = (await g).user;

	const fid = String(event.url.searchParams.get("file") ?? "").trim();
	if (!fid) return json({ error: "缺少 file 参数" }, { status: 400 });

	const obj = await getFileObject(fid);
	if (!obj) return json({ error: "文件不存在" }, { status: 404 });

	const scope = await classScopeOf(u.role, u.id);
	if (scope !== "*" && (await obj).uploader !== (u.displayName || u.username) && u.role !== "owner" && u.role !== "admin") {
		return json({ error: "无权限查看该文件的回执" }, { status: 403 });
	}

	return json({
		file: { id: (await obj).id, name: (await obj).name, kind: (await obj).kind },
		deliveries: listDeliveries(fid)
	});
}
