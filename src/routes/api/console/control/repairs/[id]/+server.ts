/**
 * 控制轴 · 报修单详情 / 改状态 / 删除（`/api/console/control/repairs/[id]`）
 *
 *   GET    — 单条报修单（需设备管理档）
 *   PATCH  — 改状态 / 写备注（需设备管理档）—— 两者都可选，至少改一项
 *   DELETE — 删除报修单（需设备管理档）
 *
 * 列表 / 建档走 `../repairs/+server.ts`。
 *
 * 权限：这一档比列表更严。列表是 viewConsole（谁进面板都能看台账），
 * 但**能改状态、能删单**等于能篡改工单状态、能抹掉排障痕迹，必须收口到 manage 档。
 *
 * 云端代理 + fail-soft 的说明见 `../repairs/+server.ts` 文件头
 * （生产副本未同步 `a5266cf` 时云端返回 404 纯文本，必须显式 `enabled:false`）。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { guardControl, readControlBody } from "$lib/server/guard-control.js";
import { cloudHttpBase, cloudViewerToken } from "$lib/server/broadcast.js";

const TIMEOUT_MS = 5000;

function repairsBase(): string | null {
	const raw = cloudHttpBase();
	if (!raw) return null;
	const m = /:(\d+)/.exec(raw);
	const port = m ? m[1] : "8788";
	// 同机部署：走回环，不绕公网域名（见 ../repairs/+server.ts 同款判断）
	return `http://127.0.0.1:${port}`;
}

async function cloudRepair(
	id: string,
	init?: RequestInit
): Promise<{ status: number; body: Record<string, unknown> } | null> {
	const base = repairsBase();
	if (!base) return null;
	try {
		const r = await fetch(`${base}/api/repairs/${encodeURIComponent(id)}`, {
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

/**
 * 区分两种 404：
 *   ① 云端没有这个端点（生产副本未同步 a5266cf）→ 面板显示「通道未启用」，不该让用户重试；
 *   ② 工单确实不存在（id 打错 / 已被删除）→ 是**业务 404**，要原样透出，用户看的是
 *      「报修单不存在：tick-…」。混成 503 会把「点错了已删除的单」谎报成平台故障。
 * 云端网关的「未知道路」错误带固定标记，用它判定。
 */
function cloudEndpointMissing(body: Record<string, unknown>): boolean {
	return /未知道路/.test(String(body.error ?? ""));
}

const DISABLED = { enabled: false, error: "云端地址未配置（PUBLIC_CLOUD_WS_URL）" };
const NOT_FOUND_HINT = { enabled: false, error: "云端未启用报修端点（生产副本尚未同步 cloud-ws a5266cf）" };
const UNREACHABLE = { enabled: false, error: "云端不可达（连接失败或超时）" };

export async function GET(event: RequestEvent) {
	const g = await guardControl(event, "manage");
	if ("error" in g) return g.error;

	const id = String(event.params.id ?? "").trim();
	if (!id) return json({ ...DISABLED, error: "缺报修单 id" }, { status: 400 });
	if (!repairsBase()) return json(DISABLED, { status: 503 });

	const res = await cloudRepair(id);
	if (!res) return json(UNREACHABLE, { status: 503 });
	if (res.status === 404 && cloudEndpointMissing(res.body)) return json(NOT_FOUND_HINT, { status: 503 });
	return json({ ...res.body, enabled: res.status === 200, ok: res.status === 200 }, { status: res.status });
}

export async function PATCH(event: RequestEvent) {
	const g = await guardControl(event, "manage");
	if ("error" in g) return g.error;

	const id = String(event.params.id ?? "").trim();
	if (!id) return json({ ...DISABLED, error: "缺报修单 id" }, { status: 400 });
	if (!repairsBase()) return json(DISABLED, { status: 503 });

	const body = await readControlBody(event);
	const status = String(body.status ?? "").trim();
	const note = String(body.note ?? "").trim();
	const hasStatus = status !== "";
	const hasNote = note !== "" || body.note !== undefined;

	// PATCH 契约与云端 updateRepair 对齐（repairs.js）：status 与 note 都可选，只校验出现的那项。
	// ⚠️ 不能强制 status —— UI 把「改状态」和「写备注」做成两个独立动作，saveNote 只发 {note}；
	// 一旦把 status 当必填，保存备注会全部 400「状态只能是…」。那是一次 e2e 漏网的真 bug：
	// 测试里 PATCH 总是同时带 status 和 note，没单独验过纯备注路径。
	if (!hasStatus && !hasNote) {
		return json({ ok: false, error: "请提供状态或备注（至少一项）" }, { status: 400 });
	}
	// 枚举必须与云端 repairs.js 一致（open|processing|fixed|closed）。
	// ⚠️ 400 响应不能带 enabled:false —— 那是「通道未启用」的降级信号，
	// 页面看到它会把横幅切到「云端未同步」，把用户的输入错误谎报成平台故障。
	if (hasStatus && !["open", "processing", "fixed", "closed"].includes(status)) {
		return json({ ok: false, error: "状态只能是 open / processing / fixed / closed" }, { status: 400 });
	}
	if (note.length > 500) {
		return json({ ok: false, error: "备注过长（≤500 字）" }, { status: 400 });
	}

	const res = await cloudRepair(id, {
		method: "PATCH",
		body: JSON.stringify({ ...(hasStatus ? { status } : {}), ...(hasNote ? { note } : {}) })
	});
	if (!res) return json(UNREACHABLE, { status: 503 });
	if (res.status === 404 && cloudEndpointMissing(res.body)) return json(NOT_FOUND_HINT, { status: 503 });
	return json({ ...res.body, enabled: res.status === 200, ok: res.status === 200 }, { status: res.status });
}

export async function DELETE(event: RequestEvent) {
	const g = await guardControl(event, "manage");
	if ("error" in g) return g.error;

	const id = String(event.params.id ?? "").trim();
	if (!id) return json({ ...DISABLED, error: "缺报修单 id" }, { status: 400 });
	if (!repairsBase()) return json(DISABLED, { status: 503 });

	const res = await cloudRepair(id, { method: "DELETE" });
	if (!res) return json(UNREACHABLE, { status: 503 });
	if (res.status === 404 && cloudEndpointMissing(res.body)) return json(NOT_FOUND_HINT, { status: 503 });
	return json({ ...res.body, enabled: res.status === 200, ok: res.status === 200 }, { status: res.status });
}
