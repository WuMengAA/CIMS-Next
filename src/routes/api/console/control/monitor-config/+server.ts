/**
 * 控制轴 · 监控参数（`/api/console/control/monitor-config`）
 *
 *   GET  — 读当前监控参数（面板 monitor 页 onMount / reset）
 *   POST — 保存监控参数（面板改截图质量 / 最大宽度 / 采样间隔 / 录像保留等）
 *
 * 设备读同一份走被控轴 `GET /api/device/monitor-config` —— **同一份数据、
 * 两个方向的两条轴**，这正是两轴分离要达成的形态：读配置是设备的事、写配置是人的事。
 *
 * 权限：读沿用 viewConsole（与其余 console 读操作同档），写需设备管理档。
 *
 * ⚠️ GET 是切换面板数据源时**补的缺口**：新轴原先只有 POST，
 * 面板 monitor 页两处 `fetch(...)` 默认 GET 会直接 405。语义逐行照搬旧
 * `GET /api/console/ext/monitor-config` 的用户会话分支。
 *
 * 白名单字段：只允许写入监控相关的键，避免任意 settings 覆盖。
 * 非白名单键**静默忽略**（不报错，因为面板可能带 UI 状态字段）——
 * 但若**一个白名单键都没命中**，则明确 400，免得"看起来保存了其实什么都没写"。
 *
 * 来源：旧 `GET/POST /api/console/ext/monitor-config`（用户会话分支）。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { saveConsoleSettings, getMonitorConfig, addAudit } from "$lib/server/console-ext.js";
import { guardControl, readControlBody } from "$lib/server/guard-control.js";

/** 监控参数白名单（与旧实现同一份）。 */
const ALLOWED = [
	"screenshot_webp_quality",
	"screenshot_max_width",
	"monitor_interval_sec",
	"monitor_retention_days",
	"video_codec",
	"video_bitrate_kbps",
	"video_fps",
	"video_resolution",
	"p2p_ice",
	"p2p_ice_override"
];

export async function GET(event: RequestEvent) {
	const g = await guardControl(event);
	if ("error" in g) return g.error;
	return json({ config: await getMonitorConfig() });
}

export async function POST(event: RequestEvent) {
	const g = await guardControl(event, "manage");
	if ("error" in g) return g.error;
	const up = g.user;

	const body = await readControlBody(event);
	if (Object.keys(body).length === 0) {
		return json({ error: "缺少配置对象" }, { status: 400 });
	}

	const patch: Record<string, unknown> = {};
	for (const k of ALLOWED) if (k in body) patch[k] = body[k];
	if (Object.keys(patch).length === 0) {
		return json({ error: "没有可保存的监控字段" }, { status: 400 });
	}

	await saveConsoleSettings(patch);
	await addAudit({
		actor: up.displayName || up.username,
		role: up.role,
		action: "monitor-config",
		target: "console",
		detail: "更新监控参数: " + Object.keys(patch).join(",")
	});
	return json({ ok: true, config: await getMonitorConfig() });
}
