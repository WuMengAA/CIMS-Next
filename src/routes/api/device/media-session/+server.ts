/**
 * 被控轴 · 媒体直连会话回报（`POST /api/device/media-session` · `DELETE ...?uid=`）
 *
 * 媒体直连（快照 / 录像下载）用，与 `../session`（VNC 远控）**结构完全对称**，
 * 只差 proto = `"media"`。
 *
 * 为什么刻意写成两个文件而不是一个带 proto 参数的：
 * 合并就得在 body 里传 proto，等于把"这条会话属于哪条链路"交给调用方声明 ——
 * 而这是**服务端该定的事**。两个文件各自写死自己的 proto，调用方没有机会声明错。
 *
 * 来源：旧 `POST/DELETE /api/console/ext/media-session`（设备密钥分支）。
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

const PROTO = "media";

export async function POST(event: RequestEvent) {
	const g = guardDevice(event);
	if ("error" in g) return g.error;

	const body = await readDeviceBody(event);
	const uid = String(body.uid ?? "").trim();
	if (!uid) return json({ error: "uid 不能为空" }, { status: 400 });

	const stopped = body.state === "stopped" || body.state === "closed" || body.port === 0;
	if (stopped) {
		const removed = clearDeviceSession(PROTO, uid);
		addAudit({
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
	// ⚠️ 用 `vnc_require_token`（**不是** media_require_token —— 那个键根本不存在，
	// CONSOLE_SETTINGS_KEYS 里没有它）。旧实现里 vnc 与 media 走的是**同一个开关**。
	// 我在初稿里写成了 `media_require_token`，那会引入一处行为变更：
	// 管理员把 `vnc_require_token` 设为 false 时，新端点会因为
	// `undefined !== false` 判成 true 而**突然开始要求令牌**，把已在跑的媒体通道打断。
	// 保持与旧实现逐字一致；若将来确实要给媒体单独一个开关，
	// 那是一次**产品变更**（要同时进 CONSOLE_SETTINGS_KEYS + 面板 + 迁移默认值），
	// 不在本次两轴分离的范围内。
	const requireToken = getConsoleSettings().vnc_require_token !== false;
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
	addAudit({
		actor: `device:${uid}`,
		role: "device",
		action: `${PROTO}.session.report`,
		target: uid,
		detail: `${ip}:${port}${token ? "（含令牌）" : "（无令牌）"}`
	});
	return json({ ok: true, session: s });
}

export function DELETE(event: RequestEvent) {
	const g = guardDevice(event);
	if ("error" in g) return g.error;

	const uid = String(event.url.searchParams.get("uid") ?? "").trim();
	if (!uid) return json({ error: "uid 不能为空" }, { status: 400 });

	const removed = clearDeviceSession(PROTO, uid);
	addAudit({
		actor: `device:${uid}`,
		role: "device",
		action: `${PROTO}.session.stop`,
		target: uid,
		detail: removed ? "会话已注销" : "无在册会话"
	});
	return json({ ok: true, cleared: removed });
}
