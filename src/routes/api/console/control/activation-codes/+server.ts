/**
 * 控制轴 · 生成设备接入码（`POST /api/console/control/activation-codes`）
 *
 * 管理员生成「一次性、绑班级、带 TTL」的接入码；教室端用 `POST /api/device/activate` 消费它。
 * 这是**一对**端点：一个发码（控制轴，人），一个消费（被控轴，设备）。
 *
 * 权限：设备管理档。
 *
 * ⚠️ **班级真实性校验，别删**：前端已改成「只能从真实班级下拉里选」，
 * 但那只是**体验层**，不是安全边界。这里必须再确认一次该班在 CIMS 里确实存在 ——
 * 否则会发出一个绑到不存在班级的接入码，教室机绑上后看不到自己的设备，排障极难。
 *
 * ⚠️ 但**取不到班级列表时（CIMS 不可达）不拦**：那属于上层要暴露的接入问题，
 * 不该在这里把一个可用的功能堵死。这个"半严格"是刻意的。
 *
 * 来源：旧 `GET/POST/DELETE /api/console/ext/device-activate` 的**用户会话分支**。
 *   · GET    —— 列出已有接入码（面板「设备控制」页 loadActCodes）。
 *   · POST   —— 生成接入码（本文件原有）。
 *   · DELETE —— 作废接入码（`?code=`）。
 *
 * ⚠️ 旧轴只有 GET/POST 真实现，DELETE 落到 catch-all 末尾的
 * `unknown path → 404`（面板「作废」一直静默失败）。本轮在新轴补齐。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { listStelarithClasses } from "$lib/server/stelarith/classes.js";
import {
	generateActivationCode,
	listActivationCodes,
	revokeActivationCode,
	addAudit
} from "$lib/server/console-ext.js";
import { guardControl, readControlBody } from "$lib/server/guard-control.js";

export function GET(event: RequestEvent) {
	const g = guardControl(event, "manage");
	if ("error" in g) return g.error;
	return json({ codes: listActivationCodes() });
}

export async function POST(event: RequestEvent) {
	const g = guardControl(event, "manage");
	if ("error" in g) return g.error;
	const up = g.user;

	const body = await readControlBody(event);
	const classId = String(body.classId ?? "").trim();
	const className = String(body.className ?? classId).trim();
	const hours = Math.min(Math.max(Number(body.hours) || 24, 1), 720);
	if (!classId) return json({ error: "缺少 classId" }, { status: 400 });

	// 班级真实性校验（见文件头）。2026-10-04：本地 stelarith_classes 优先，CIMS 兜底。
	let knownClasses = listStelarithClasses();
	if (!knownClasses.length) {
		try {
			const { fetchClassList } = await import("$lib/server/cims-client.js");
			const cims = (await fetchClassList()) ?? [];
			// CIMS 兜底：形状转成自有 StelarithClass（sort_order/created_at/school_id 补默认）
			knownClasses = cims.map((c, i) => ({
				class_id: String(c.class_id ?? ""),
				name: String(c.name ?? c.class_id ?? ""),
				code: String(c.code ?? ""),
				sort_order: i,
				school_id: "",
				created_at: new Date().toISOString()
			}));
		} catch { /* fallthrough */ }
	}
	if (knownClasses.length && !knownClasses.some((c) => c.class_id === classId)) {
		return json({ error: `班级不存在：${classId}（请从真实班级列表中选择）` }, { status: 400 });
	}

	const item = generateActivationCode({ classId, className, hours });
	addAudit({
		actor: up.displayName || up.username,
		role: up.role,
		action: "device-activate",
		target: "console",
		detail: "生成接入码 " + item.code + " 绑 " + className
	});
	return json({ ok: true, code: item }, { status: 201 });
}

export function DELETE(event: RequestEvent) {
	const g = guardControl(event, "manage");
	if ("error" in g) return g.error;

	const code = String(event.url.searchParams.get("code") ?? "").trim();
	if (!code) return json({ error: "缺少 code" }, { status: 400 });
	// 假 code（不存在）→ revoke 返回 false → `{ ok: false }`，不是 500。
	return json({ ok: revokeActivationCode(code) });
}
