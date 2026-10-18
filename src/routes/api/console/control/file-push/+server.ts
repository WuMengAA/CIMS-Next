/**
 * 控制轴 · 推送文件到教室（`POST /api/console/control/file-push`）
 *
 * 传文件的**下半场**：把已上传的文件推给目标班级/设备（`file_push` 指令）。
 *
 * 两道关：
 *   · **能力关** —— `file` 动作（v2 矩阵：老师/班主任/电教委员/站长）；
 *   · **范围关** —— 目标班级必须 ⊆ 调用者绑定班级（站长 `"*"` 全校）。
 *
 * ⚠️ 三条判据，都从旧实现原样搬来：
 *   1. **班级范围必须在 POST 分支内重算**（`classScopeOf`）。旧实现曾在 POST 里
 *      直接用只在 GET 定义过的变量 → `ReferenceError` → 线上 500。
 *      这是"共享变量只在一条分支定义"的经典坑。
 *   2. **目标 uid 必须用 CIMS 里真实登记的那个大小写**（`canonicalUid`）。
 *      `send-notification` 大小写敏感，同机常并存 `N7-20091211`（桌面端，在线）
 *      与 `n7-20091211`（旧记录，离线）两条；一律小写会把指令投进**没人轮询**的
 *      离线记录 —— CIMS 照样回「通知已递送」，设备却收不到、回执永远 pending。
 *   3. 目标班级/设备**解析不到就明确报错**，不退化成全校下发。
 *
 * 来源：旧 `POST /api/console/ext/file-push`。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { classScopeOf, scopeCovers } from "$lib/server/class-scope.js";
import { fetchDeviceClassMap, canonicalUid } from "$lib/server/cims-client.js";
import { getFileObject, pushFileToDevices } from "$lib/server/file-transfer.js";
import { addAudit } from "$lib/server/console-ext.js";
// ⚠️ 细档 `file`（DeviceAction），用 `guardControlDeviceAction`。见同批 `./files` 的注释。
import { guardControlDeviceAction, readControlBody } from "$lib/server/guard-control.js";

export async function POST(event: RequestEvent) {
	const g = await guardControlDeviceAction(event, "file");
	if ("error" in g) return g.error;
	const u = g.user;

	// ⚠️ 班级范围**在本分支内重算**（见文件头判据 1）。
	const scope = await classScopeOf(u.role, u.id);

	const body = await readControlBody(event);
	const fid = String(body.file_id ?? "").trim();
	const file = fid ? await getFileObject(fid) : null;
	if (!file) return json({ error: "文件不存在（请先上传）" }, { status: 404 });

	const wantClasses: string[] = Array.isArray(body.classes)
		? (body.classes as unknown[]).map((c) => String(c).trim()).filter(Boolean).slice(0, 20)
		: [];
	const wantUids: string[] = Array.isArray(body.uids)
		? (body.uids as unknown[]).map((c) => String(c).trim()).filter(Boolean).slice(0, 200)
		: [];
	if (wantClasses.length === 0 && wantUids.length === 0) {
		return json({ error: "请指定目标班级或设备" }, { status: 400 });
	}

	const map = await fetchDeviceClassMap();
	if (!map) return json({ error: "CIMS 不可达，无法解析目标设备" }, { status: 502 });

	// ⚠️ 目标 uid 必须用 CIMS 里真实登记的那个大小写（见文件头判据 2）。
	const uids = new Set<string>();
	const targets: string[] = [];

	// 班级 → 设备；每个目标班先过范围关（class_id 或名称命中都算）。
	for (const c of wantClasses) {
		const hit = map.classes.find((x) => x.class_id === c || x.name === c);
		if (!hit) return json({ error: `班级不存在或未绑定设备：${c}` }, { status: 404 });
		if (scope !== "*" && !scopeCovers(scope, hit.class_id)) {
			return json({ error: `班级 ${hit.name || hit.class_id} 不在你的绑定范围内` }, { status: 403 });
		}
		targets.push(hit.class_id);
		for (const d of map.devices) {
			if (d.class_id && d.class_id.toLowerCase() === hit.class_id.toLowerCase()) {
				uids.add(d.uid);
			}
		}
	}

	// 直接指定设备：逐台查班级、过范围关。
	for (const uid of wantUids) {
		const cid = map.uidToClass.get(uid.toLowerCase()) ?? "";
		if (scope !== "*") {
			if (!cid || !scopeCovers(scope, cid)) {
				return json({ error: `设备 ${uid} 不在你的绑定范围内（或未划班）` }, { status: 403 });
			}
		}
		uids.add(canonicalUid(map, uid));
		if (cid && !targets.includes(cid)) targets.push(cid);
	}

	if (uids.size === 0) return json({ error: "目标班级下没有可推送的设备" }, { status: 404 });

	const results = await pushFileToDevices(file, [...uids], (uid2) =>
		map.uidToClass.get(uid2.toLowerCase()) ?? ""
	);
	await addAudit({
		actor: u.displayName || u.username,
		role: u.role,
		action: "file_push",
		target: targets.join("、") || uids.size + " 台设备",
		detail: `推送「${(await file).name}」（${Math.round((await file).size / 1024)}KB）到 ${uids.size} 台设备`
	});
	return json({ ok: true, file: { id: (await file).id, name: (await file).name }, targets, results }, { status: 201 });
}
