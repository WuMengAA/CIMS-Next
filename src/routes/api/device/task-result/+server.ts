/**
 * 被控轴 · 任务级回执（`POST /api/device/task-result`）
 *
 * **回单**：设备做完一个动作后，带着下发时那个 `task_id` 回报结果
 * （成没成、结果存在哪）。与控制轴 `GET /api/console/control/tasks?task_id=` 对称。
 *
 * 为什么要跟 `events` 分开：只有流水账时，面板只能拿"最近一条截图事件"去猜结果 ——
 * 连点两次截图就分不清哪张是哪次的。`task_id` 让"这次点击"和"那次上报"对得上号。
 *
 * 命中不了**不是错误**，但要给原因：回 `ok:true` 而什么都没改，会让设备以为回报成功了，
 * 面板那头却永远等不到结果 —— 这正是这类功能最难查的形态（调用方以为成功、日志一片绿）。
 *
 * 来源：旧 `POST /api/console/ext/task-result`（设备密钥分支）。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { putTaskResult, addAudit } from "$lib/server/console-ext.js";
import { guardDevice, readDeviceBody } from "$lib/server/guard-device.js";

export async function POST(event: RequestEvent) {
	const g = guardDevice(event);
	if ("error" in g) return g.error;

	const body = await readDeviceBody(event);
	const tid = String(body.task_id ?? "").trim();
	if (!tid) return json({ error: "task_id 不能为空" }, { status: 400 });

	const rawExtra =
		body.extra && typeof body.extra === "object" && !Array.isArray(body.extra)
			? (body.extra as Record<string, unknown>)
			: undefined;

	const row = putTaskResult(tid, String(body.state ?? "done"), String(body.result ?? ""), rawExtra);
	if (!row) {
		return json({ ok: false, reason: "任务不存在（task_id 无效或已被清理）" }, { status: 404 });
	}

	addAudit({
		actor: `device:${row.uid}`,
		role: "device",
		action: "task.result",
		target: tid,
		detail: `${row.kind} ${row.state}${row.result ? "：" + row.result.slice(0, 120) : ""}`
	});
	return json({ ok: true, task: row });
}
