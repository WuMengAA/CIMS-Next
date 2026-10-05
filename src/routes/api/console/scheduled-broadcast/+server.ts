import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { userCan } from "$lib/permissions.js";
import {
	listScheduledBroadcasts,
	saveScheduledBroadcast,
	toggleScheduledBroadcast,
	deleteScheduledBroadcast
} from "$lib/server/scheduled-broadcast.js";
import { addAudit } from "$lib/server/console-ext.js";
import { cloudHttpBase, cloudViewerToken } from "$lib/server/broadcast.js";
import { listDeviceBindings } from "$lib/server/device-bindings.js";

/**
 * 定时广播（2026-10-05 · 取代 CIMS scheduled-broadcast）。
 *
 *  GET    /api/console/scheduled-broadcast                  → { items }
 *  POST   /api/console/scheduled-broadcast                 建/改 {id?, name, schedule_type, run_at, weekday?, target_class_id, title, content, enabled}
 *  POST   /api/console/scheduled-broadcast?action=toggle&id=&enabled=  启停
 *  DELETE /api/console/scheduled-broadcast?id=             删除
 *  POST   /api/console/scheduled-broadcast?action=fire-now&id=  立即触发（复用 notify 通道）
 *
 * 权限：manageDevices。fire-now 向目标班级设备推大屏通知（云端指令通道）。
 */
function authUser(event: RequestEvent) {
	const cookieToken = event.cookies.get("admin_token");
	let u = cookieToken ? verifyToken(cookieToken) : null;
	if (!u) {
		const auth = event.request.headers.get("authorization") ?? "";
		if (auth.toLowerCase().startsWith("bearer ")) u = verifyToken(auth.slice(7).trim());
	}
	return u;
}

/** fire-now：向目标班级的设备推 notify（复用广播通道）。 */
async function fireNow(u: NonNullable<ReturnType<typeof authUser>>, id: number) {
	const items = listScheduledBroadcasts();
	const it = items.find((x) => x.id === id);
	if (!it) return { ok: false, error: "不存在" };
	const base = cloudHttpBase();
	const token = cloudViewerToken();
	if (!base || !token) return { ok: false, error: "云端未配置" };
	// 目标班级的设备
	const bindings = listDeviceBindings().filter((b) => b.class_id === it.target_class_id && b.status === "active");
	if (!bindings.length) return { ok: false, error: "该班级没有已登记设备" };
	let sent = 0;
	for (const b of bindings) {
		try {
			const r = await fetch(`${base}/api/instructions`, {
				method: "POST",
				headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
				body: JSON.stringify({ uid: b.uid, action: "notify", params: { title: it.title || it.name, content: it.content, kind: "fullscreen" } }),
				signal: AbortSignal.timeout(5000)
			});
			if (r.ok) sent++;
		} catch { /* 单台失败跳过 */ }
	}
	addAudit({ actor: u.displayName || u.username, role: u.role, action: "scheduled-fire-now", target: "console", detail: `立即触发定时广播 #${id}，${sent}/${bindings.length} 台收到` });
	return { ok: true, sent, total: bindings.length };
}

export async function GET(event: RequestEvent) {
	const u = authUser(event);
	if (!u) return json({ error: "请先登录" }, { status: 401 });
	if (!userCan(u, "viewConsole")) return json({ error: "无权限" }, { status: 403 });
	return json({ items: listScheduledBroadcasts() });
}

export async function POST(event: RequestEvent) {
	const u = authUser(event);
	if (!u) return json({ error: "请先登录" }, { status: 401 });
	if (!userCan(u, "manageDevices")) return json({ error: "无权限（需设备管理档）" }, { status: 403 });

	const action = event.url.searchParams.get("action") ?? "";
	if (action === "toggle") {
		const id = Number(event.url.searchParams.get("id") ?? 0);
		const enabled = event.url.searchParams.get("enabled") === "1";
		if (!id) return json({ error: "缺少 id" }, { status: 400 });
		toggleScheduledBroadcast(id, enabled);
		addAudit({ actor: u.displayName || u.username, role: u.role, action: "scheduled-toggle", target: "console", detail: `${enabled ? "启用" : "停用"}定时广播 #${id}` });
		return json({ ok: true });
	}
	if (action === "fire-now") {
		const id = Number(event.url.searchParams.get("id") ?? 0);
		if (!id) return json({ error: "缺少 id" }, { status: 400 });
		const r = await fireNow(u, id);
		if (!r.ok) return json({ error: r.error }, { status: 400 });
		return json({ ok: true, sent: r.sent, total: r.total });
	}

	const body = (await event.request.json().catch(() => ({}))) as Record<string, unknown>;
	const id = Number(body.id ?? 0);
	const r = saveScheduledBroadcast(id, {
		name: body.name ? String(body.name) : "",
		schedule_type: body.schedule_type ? String(body.schedule_type) : "once",
		weekday: body.weekday !== undefined && body.weekday !== null ? Number(body.weekday) : null,
		run_at: body.run_at ? String(body.run_at) : "",
		target_class_id: body.target_class_id ? String(body.target_class_id) : "",
		title: body.title ? String(body.title) : "",
		content: body.content ? String(body.content) : "",
		enabled: body.enabled !== false
	});
	if (!r.ok) return json({ error: r.error }, { status: 400 });
	addAudit({ actor: u.displayName || u.username, role: u.role, action: id > 0 ? "scheduled-update" : "scheduled-create", target: "console", detail: `${id > 0 ? "改" : "建"}定时广播 #${r.item!.id}` });
	return json({ ok: true, item: r.item }, { status: id > 0 ? 200 : 201 });
}

export async function DELETE(event: RequestEvent) {
	const u = authUser(event);
	if (!u) return json({ error: "请先登录" }, { status: 401 });
	if (!userCan(u, "manageDevices")) return json({ error: "无权限（需设备管理档）" }, { status: 403 });
	const id = Number(event.url.searchParams.get("id") ?? 0);
	if (!id) return json({ error: "缺少 id" }, { status: 400 });
	deleteScheduledBroadcast(id);
	addAudit({ actor: u.displayName || u.username, role: u.role, action: "scheduled-delete", target: "console", detail: `删除定时广播 #${id}` });
	return json({ ok: true });
}