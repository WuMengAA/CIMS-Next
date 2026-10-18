import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { userCan } from "$lib/permissions.js";
import { cloudHttpBase, cloudViewerToken } from "$lib/server/broadcast.js";
import { addAudit } from "$lib/server/console-ext.js";

/**
 * 设备指令下发（2026-10-05 · 彻底去 CIMS：devices 页锁屏/关机/重启等动作的自有通道）。
 *
 * POST /api/console/control/device-command  {uid, action, params?}
 *  → 站点鉴权（manageDevices）→ 云端 `/api/instructions`（Bearer）→ 被控端执行 → 回执。
 *
 * 取代：旧 `/api/console/cims/account/{acct}/client/{uid}/command/*`（CIMS 转发）+ stelarith_task。
 * 被控端已原生支持这些动作（lock/shutdown/reboot/screenshot/restart/set_volume/…），
 * 走云端 WS 指令通道即可，无需 CIMS 中介。
 *
 * 返回：{ok, state: "sent"|"offline"|"error", uid, action} —— sent=已写进设备连接（等回执）；
 * offline=设备不在线（绝不谎报）；error=云端不可达。
 */
export async function POST(event: RequestEvent) {
	const cookieToken = event.cookies.get("admin_token");
	let u = cookieToken ? await verifyToken(cookieToken) : null;
	if (!u) {
		const auth = event.request.headers.get("authorization") ?? "";
		if (auth.toLowerCase().startsWith("bearer ")) u = await verifyToken(auth.slice(7).trim());
	}
	if (!u) return json({ error: "请先登录" }, { status: 401 });
	if (!userCan(u, "manageDevices")) return json({ error: "无权限（需设备管理档）" }, { status: 403 });

	const base = cloudHttpBase();
	const token = cloudViewerToken();
	if (!base || !token) return json({ error: "云端未配置" }, { status: 503 });

	const body = (await event.request.json().catch(() => ({}))) as Record<string, unknown>;
	const uid = String(body.uid ?? "").trim();
	const action = String(body.action ?? "").trim();
	if (!uid || !action) return json({ error: "缺少 uid 或 action" }, { status: 400 });
	const params = (body.params && typeof body.params === "object" ? body.params : {}) as Record<string, unknown>;

	try {
		const r = await fetch(`${base}/api/instructions`, {
			method: "POST",
			headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
			body: JSON.stringify({ uid, action, params }),
			signal: AbortSignal.timeout(5000)
		});
		const d = (await r.json().catch(() => ({}))) as { state?: string; detail?: string };
		const state = r.status === 200 ? "sent" : r.status === 409 ? "offline" : "error";

		await addAudit({
			actor: u.displayName || u.username,
			role: u.role,
			action: "device-command",
			target: "console",
			detail: `下发 ${action} → ${uid}（${state}${d.detail ? "：" + String(d.detail).slice(0, 80) : ""}）`
		});

		if (state === "sent") return json({ ok: true, state, uid, action });
		return json({ ok: false, state, uid, action, detail: d.detail || (state === "offline" ? "设备不在线" : "云端响应异常") }, { status: state === "offline" ? 409 : 502 });
	} catch {
		await addAudit({ actor: u.displayName || u.username, role: u.role, action: "device-command", target: "console", detail: `下发 ${action} → ${uid} 失败（云端不可达）` });
		return json({ ok: false, state: "error", uid, action, detail: "云端不可达" }, { status: 502 });
	}
}