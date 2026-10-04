/**
 * 控制轴 · 审计裁剪（`POST /api/console/control/audit/prune`）
 *
 * 按保留期裁剪审计。权限：**设备管理档**（会删数据）。
 *
 * ⚠️ **裁剪本身也要留痕** —— 否则「某天的记录去哪了」会成为又一个无法自证的疑点，
 * 而这正是审计要消灭的东西。所以 `addAudit` 在这里不是可选的。
 *
 * 来源：旧 `POST /api/console/ext/audit/prune`。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { pruneAudit, addAudit } from "$lib/server/console-ext.js";
import { guardControl, readControlBody } from "$lib/server/guard-control.js";

export async function POST(event: RequestEvent) {
	const g = guardControl(event, "manage");
	if ("error" in g) return g.error;
	const actor = g.user.displayName || g.user.username;

	const body = await readControlBody(event);
	const days = Number(body.days) || undefined;
	const r = pruneAudit(days);

	addAudit({
		actor,
		role: g.user.role,
		action: "audit.prune",
		target: String(r.retentionDays),
		detail: `裁剪审计：删除 ${r.removed} 条（保留 ${r.retentionDays} 天，截止 ${r.cutoff}），锚点=${(r.anchor || "无").slice(0, 12)}`
	});
	return json({ ok: true, ...r }, { status: 201 });
}
