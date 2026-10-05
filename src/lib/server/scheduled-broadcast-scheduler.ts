/**
 * 定时广播调度器（2026-10-05 · 站点自持，取代 CIMS 后端调度器）。
 *
 * 每 30s 扫描 dueScheduledBroadcasts → 向目标班级设备推大屏通知（云端 notify 通道）→ 标记已执行。
 * 由 hooks.server.ts 的 init 挂载（进程启动即开始；adapter-node 单进程，安全）。
 * 幂等：markScheduledRun 后 once 型自动禁用、周期型重算 next_run，不会重复推。
 */
import { dueScheduledBroadcasts, markScheduledRun } from "./scheduled-broadcast.js";
import { cloudHttpBase, cloudViewerToken } from "./broadcast.js";
import { listDeviceBindings } from "./device-bindings.js";

let started = false;

export function startScheduledBroadcastScheduler(): void {
	if (started) return;
	started = true;

	setInterval(async () => {
		try {
			const due = dueScheduledBroadcasts();
			if (!due.length) return;
			const base = cloudHttpBase();
			const token = cloudViewerToken();
			if (!base || !token) return; // 云端未配置：等下次扫描

			for (const it of due) {
				const bindings = listDeviceBindings().filter((b) => b.class_id === it.target_class_id && b.status === "active");
				if (bindings.length) {
					for (const b of bindings) {
						try {
							await fetch(`${base}/api/instructions`, {
								method: "POST",
								headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
								body: JSON.stringify({ uid: b.uid, action: "notify", params: { title: it.title || it.name, content: it.content, kind: "fullscreen" } }),
								signal: AbortSignal.timeout(5000)
							});
						} catch { /* 单台失败跳过，仍标记已执行（不重推） */ }
					}
				}
				markScheduledRun(it.id);
				console.log(`[scheduled-broadcast] 已触发 #${it.id}「${it.name}」→ ${bindings.length} 台设备`);
			}
		} catch (err) {
			console.warn("[scheduled-broadcast] 调度器异常：", err);
		}
	}, 30_000);
}