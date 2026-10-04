/**
 * 控制轴 · 任务单（`/api/console/control/tasks`）
 *
 *   POST — 建一张任务单：操控端下发动作前先拿 `task_id`，随指令一起给设备，
 *          设备做完带同一个 id 回报 —— 「这次点击」和「那次上报」才对得上号。
 *   GET  — 按 `task_id` 查单个动作的结果，或按 `uid` 列这台机器最近的活。
 *          每次查询顺手 `timeoutTasks(5)` 做一次**超时判死**：
 *          设备掉线时没有这一步，按钮会永远停在「等待回执」，老师只看到转圈。
 *
 * 权限档位刻意放低（POST 用 `submitIssue`）：这张单子本身**不赋权**，
 * 真正的闸门是动作在下发侧的校验（设备轴 / 班级范围）。卡太死反而会让
 * 合法动作拿不到回单，又退化成"点了不知道成没成"。
 *
 * ⚠️ 查不到必须给明确 404：返回 `ok:true` + null 会让调用方以为"还没好"，
 * 于是继续轮询一个根本不存在的任务（这类假象最难查）。
 *
 * 来源：旧 `GET/POST /api/console/ext/task`。
 * 对称的被控轴是 `POST /api/device/task-result`（设备回报结果）。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { createTask, getTask, listTasks, timeoutTasks } from "$lib/server/console-ext.js";
import { guardControl, readControlBody } from "$lib/server/guard-control.js";

export function GET(event: RequestEvent) {
	const g = guardControl(event);
	if ("error" in g) return g.error;

	// 每次查询顺手做一次超时判死（见文件头）。
	timeoutTasks(5);
	const q = event.url.searchParams;
	const tid = String(q.get("task_id") ?? "").trim();
	if (tid) {
		const t = getTask(tid);
		if (!t) return json({ error: "任务不存在（task_id 无效或已被清理）" }, { status: 404 });
		return json({ task: t });
	}
	return json({ tasks: listTasks(q.get("uid") || undefined, Number(q.get("limit") ?? 50) || 50) });
}

export async function POST(event: RequestEvent) {
	const g = guardControl(event, "submitIssue");
	if ("error" in g) return g.error;
	const actor = g.user.displayName || g.user.username;

	const body = await readControlBody(event);
	const uid = String(body.uid ?? "").trim();
	const kind = String(body.kind ?? "").trim();
	if (!uid || !kind) return json({ error: "uid/kind 不能为空" }, { status: 400 });

	try {
		const t = createTask({ uid, kind, actor });
		return json({ ok: true, task_id: t.task_id, task: t }, { status: 201 });
	} catch (e) {
		return json({ error: String((e as Error)?.message ?? e) }, { status: 400 });
	}
}
