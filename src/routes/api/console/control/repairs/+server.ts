/**
 * 控制轴 · 设备报修（`/api/console/control/repairs`）
 *
 *   GET  — 报修台账列表（按提交时间倒序）
 *   POST — 新建报修单（需设备管理档）
 *
 * 详情 / 改状态 / 删除走 `./[id]/+server.ts`。
 *
 * ## 这是云端代理，不是本地存储
 *
 * 报修台账的唯一真源是**云端** `repairs.json`（cloud-ws `src/repairs.js`，2026-10-08 `a5266cf`），
 * 站点不另存一份——否则老师和被控端 OOBE 报的同一件事会出现两套账，谁对谁错没法判。
 * 本路由只做两件事：① 控制轴权限守卫；② 透传云端 REST。
 *
 * 权限口径与 `events`（执行回执流水）同档：
 *   GET  → viewConsole（台账不含教师身份等敏感信息，只含设备与故障描述）
 *   POST → `canDevice(role, "manage")` —— 能建档 = 能改云端台账，不该给只读档的人。
 *
 * ## ⚠️ fail-soft（生产云端可能还没这个端点）
 *
 * 生产 8788 跑的是**独立副本** `D:\Stelarith\Stelarith-cloud-ws`，那份尚未同步 `a5266cf`
 * ⇒ `/api/repairs` 返回 404，且响应体**不是 JSON**（纯文本 404）。
 * 所以这里必须 `enabled` 显式回信号，而不是抛异常或让面板白屏：
 * 前端看到 `enabled: false` 就显示「设备报修通道未启用」，不重试、不刷屏。
 * 站点重启后（或云端副本同步后）自动恢复，不需要改代码。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { guardControl, readControlBody } from "$lib/server/guard-control.js";
import { cloudHttpBase, cloudViewerToken } from "$lib/server/broadcast.js";

const TIMEOUT_MS = 5000;

/**
 * 云端 HTTP 基址：同机时走回环，不绕公网。
 * `PUBLIC_CLOUD_WS_URL` 配的是公网 ws 域名（wss://control.245959623.xyz），
 * 站点与云端同机 ⇒ 回环 127.0.0.1:8788 更近，也少一跳 TLS。
 * 非生产（未配公网域名）时从 ws 配置推导 http 基址，保留通用性。
 */
function repairsBase(): string | null {
	const raw = cloudHttpBase();
	if (!raw) return null;
	// 从 ws 配置里抠端口（wss://host:8788 → 8788），没有端口则用 8788
	const m = /:(\d+)/.exec(raw);
	const port = m ? m[1] : "8788";
	// 公网域名一律走回环：公网域名是给外部被控端/管理端用的，
	// 站点自己调云端不该绕出内网（broadcast.ts 已在同机部署前提下调它）。
	return `http://127.0.0.1:${port}`;
}

async function cloudRepairs(path: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> } | null> {
	const base = repairsBase();
	if (!base) return null;
	try {
		const r = await fetch(`${base}${path}`, {
			headers: { "content-type": "application/json", Authorization: `Bearer ${cloudViewerToken()}` },
			signal: AbortSignal.timeout(TIMEOUT_MS),
			...init
		});
		const text = await r.text();
		let body: Record<string, unknown> = {};
		try {
			body = JSON.parse(text) as Record<string, unknown>;
		} catch {
			// 纯文本 404（云端没有这个端点）——交给调用方按 status 判
		}
		return { status: r.status, body };
	} catch {
		return null;
	}
}

export async function GET(event: RequestEvent) {
	const g = await guardControl(event);
	if ("error" in g) return g.error;

	if (!repairsBase()) {
		return json({ ok: false, enabled: false, reason: "云端地址未配置（PUBLIC_CLOUD_WS_URL）", items: [] });
	}
	const res = await cloudRepairs("/api/repairs");
	if (!res) return json({ ok: false, enabled: false, reason: "云端不可达（连接失败或超时）", items: [] });
	if (res.status === 404) {
		return json({ ok: false, enabled: false, reason: "云端未启用报修端点（生产副本尚未同步 cloud-ws a5266cf）", items: [] });
	}
	const repairs = Array.isArray(res.body.repairs) ? res.body.repairs : [];
	return json({ ok: res.status === 200, enabled: true, items: repairs });
}

export async function POST(event: RequestEvent) {
	const g = await guardControl(event, "manage");
	if ("error" in g) return g.error;

	// 输入校验必须在「云端是否可用」之前：非法输入恒为 400（客户端错误，重试无意义），
	// 不能先查云端配置再拦字段 —— 否则云端未配置时会把「用户填错严重度」报成 503 服务端故障，
	// 前端会误提示「云端不可达」，让用户以为是平台问题而不是自己的输入。
	const body = await readControlBody(event);
	const uid = String(body.uid ?? "").trim();
	const symptom = String(body.symptom ?? "").trim();
	const severity = String(body.severity ?? "").trim();
	const reporter = String(body.reporter ?? "").trim();
	// 枚举值必须与云端 repairs.js 一致（severity: low|normal|urgent，见 cloud-ws a5266cf）；
	// 这里写错会导致「面板报成功、云端按 unknown 处理」的假绿，所以上游就把住。
	if (!uid || !symptom) return json({ ok: false, error: "设备 uid 与故障描述均不能为空" }, { status: 400 });
	if (symptom.length > 200) return json({ ok: false, error: "症状描述过长（≤200 字）" }, { status: 400 });
	if (!["low", "normal", "urgent"].includes(severity)) {
		return json({ ok: false, error: "严重度只能是 low / normal / urgent" }, { status: 400 });
	}

	if (!repairsBase()) {
		return json({ ok: false, enabled: false, error: "云端地址未配置（PUBLIC_CLOUD_WS_URL）" }, { status: 503 });
	}

	const res = await cloudRepairs("/api/repairs", {
		method: "POST",
		body: JSON.stringify({ uid, symptom, severity, ...(reporter ? { reporter } : {}) })
	});
	if (!res) return json({ ok: false, enabled: false, error: "云端不可达（连接失败或超时）" }, { status: 503 });
	if (res.status === 404) {
		return json({ ok: false, enabled: false, error: "云端未启用报修端点（生产副本尚未同步 cloud-ws a5266cf）" }, { status: 503 });
	}
	// ecode / http 原样透传：面板要区分 400 校验失败与 500 服务端故障
	return json({ ...res.body, enabled: res.status === 201, ok: res.status === 201 }, { status: res.status === 201 ? 201 : res.status });
}
