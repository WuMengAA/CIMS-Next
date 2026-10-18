/**
 * 被控轴 · VNC 会话回报（`POST /api/device/session` · `DELETE /api/device/session?uid=`）
 *
 * 教室端代理把"远控端口开在哪"回报给服务端，面板轮询取地址（控制轴）
 * 再嵌进 iframe —— 这个报文是**那条链路的唯一来源**。
 * 旧实现曾把这条汇报**直接丢弃**（POST 只回 ok、GET 恒 null），
 * 造成"面板一直等待设备回报会话地址…"这个永远等不到的状态。别再犯。
 *
 * POST body：`{ uid, ip, port, token?, state?, extra? }`
 *   · `state === "stopped" | "closed"` 或 `port === 0` → **注销**会话（别留死地址给面板）
 *   · 否则必须 `ip` + 合法 `port`；面板配置要求令牌时**无令牌直接拒收**，
 *     好过登记下来让面板去连一个裸端口。
 *
 * DELETE：按 `?uid=` 注销。与控制轴的 `DELETE /api/console/control/sessions` 对称。
 *
 * 来源：旧 `POST/DELETE /api/console/ext/vnc-session`（设备密钥分支）。
 * 媒体直连会话见同目录 `../media-session` —— 两者只差一个 proto 字段，
 * 但**刻意不合并**：合并就得在 body 里传 proto，等于把"哪条会话"交给调用方声明，
 * 而这是服务端该定的事。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import {
	putDeviceSession,
	clearDeviceSession,
	getConsoleSettings,
	addAudit
} from "$lib/server/console-ext.js";
import { guardDevice, readDeviceBody } from "$lib/server/guard-device.js";

const PROTO = "vnc";

export async function POST(event: RequestEvent) {
	const g = guardDevice(event);
	if ("error" in g) return g.error;

	const body = await readDeviceBody(event);
	const uid = String(body.uid ?? "").trim();
	if (!uid) return json({ error: "uid 不能为空" }, { status: 400 });

	// 代理上报 stopped/closed/port=0 时注销会话，别留死地址给面板。
	const stopped = body.state === "stopped" || body.state === "closed" || body.port === 0;
	if (stopped) {
		const removed = clearDeviceSession(PROTO, uid);
		await addAudit({
			actor: `device:${uid}`,
			role: "device",
			action: `${PROTO}.session.stop`,
			target: uid,
			detail: removed ? "会话已注销" : "无在册会话"
		});
		return json({ ok: true, session: null, state: "cleared" });
	}

	const ip = String(body.ip ?? "").trim();
	const port = Number(body.port ?? 0);
	if (!ip || !Number.isFinite(port) || port <= 0 || port > 65535) {
		return json({ error: "ip/port 非法" }, { status: 400 });
	}

	const token = String(body.token ?? "").trim();
	const requireToken = await (await getConsoleSettings()).vnc_require_token !== false;
	if (requireToken && !token) {
		return json({ error: "配置要求会话令牌，但上报未带 token" }, { status: 400 });
	}

	const s = putDeviceSession({
		uid,
		proto: PROTO,
		ip,
		port,
		token,
		extra:
			body.extra && typeof body.extra === "object" && !Array.isArray(body.extra)
				? (body.extra as Record<string, unknown>)
				: undefined
	});
	await addAudit({
		actor: `device:${uid}`,
		role: "device",
		action: `${PROTO}.session.report`,
		target: uid,
		detail: `${ip}:${port}${token ? "（含令牌）" : "（无令牌）"}`
	});
	return json({ ok: true, session: s });
}

export async function DELETE(event: RequestEvent) {
	const g = guardDevice(event);
	if ("error" in g) return g.error;

	const uid = String(event.url.searchParams.get("uid") ?? "").trim();
	if (!uid) return json({ error: "uid 不能为空" }, { status: 400 });

	const removed = clearDeviceSession(PROTO, uid);
	await addAudit({
		actor: `device:${uid}`,
		role: "device",
		action: `${PROTO}.session.stop`,
		target: uid,
		detail: removed ? "会话已注销" : "无在册会话"
	});
	return json({ ok: true, cleared: removed });
}
