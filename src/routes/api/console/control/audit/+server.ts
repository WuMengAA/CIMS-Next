/**
 * 控制轴 · 操作日志（`/api/console/control/audit`）
 *
 *   GET  — 读审计（可按 action 过滤）
 *   POST — 记一条操作日志（面板主动补记时用）
 *
 * 来源：旧 `GET/POST /api/console/ext/audit`。
 * ⚠️ 审计链的**自检**在 `./audit/verify`、**裁剪**在 `./audit/prune` —— 三件事分开，
 * 因为它们的权限档与副作用完全不同（读 / 自检只读 / 裁剪会删数据）。
 *
 * 注意路径命名：`audit/verify` 与 `audit/prune` 是子目录，
 * SvelteKit 会把更具体的路由优先匹配给它们，**不会**落到本文件 ——
 * 这正是旧实现落在同一个 `switch` 里、还踩过"两个 catch-all 互相遮蔽"的地方，
 * 拆成真目录后这类遮蔽在结构上就不存在了。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { listAudit, addAudit } from "$lib/server/console-ext.js";
import { guardControl, readControlBody } from "$lib/server/guard-control.js";

export function GET(event: RequestEvent) {
	const g = guardControl(event);
	if ("error" in g) return g.error;

	const q = event.url.searchParams;
	return json(listAudit(Number(q.get("limit") ?? 100) || 100, q.get("action") || undefined));
}

export async function POST(event: RequestEvent) {
	const g = guardControl(event, "submitIssue");
	if ("error" in g) return g.error;

	const body = await readControlBody(event);
	if (!body.action) return json({ error: "缺少 action" }, { status: 400 });

	const item = addAudit({
		actor: g.user.displayName || g.user.username,
		role: g.user.role,
		action: String(body.action),
		target: body.target as string | undefined,
		detail: body.detail as string | undefined
	});
	return json(item, { status: 201 });
}
