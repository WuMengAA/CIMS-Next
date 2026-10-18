/**
 * 被控轴 · P2P 信令令牌（`GET /api/device/p2p-token?uid=<设备码>`）
 *
 * 教室端（被控方）取自己那一份 WebRTC 信令凭据，用于连信令边车。
 *
 * 令牌 = `HMAC-SHA256(HMAC_KEY, "p2p:<uid>")` 的 hex —— **确定性派生**，
 * 无需新增存储：控制器与被控端各自用同一 `(uid, 站点密钥)` 算，天然一致。
 * `expiresIn: 0` = 长期有效（教室机重连即用同一令牌）。
 *
 * 顺手把令牌**注入信令边车**（`/register-device`，幂等）。边车没起则忽略，
 * **不阻塞**调用方 —— 取令牌本身是主要目的，注册是顺路。
 *
 * ICE：优先取监控配置的 `p2p_ice_override`（管理员可填 TURN/STUN JSON 数组），
 * 留空回退默认 STUN（仅打洞可达；**配了 TURN 才有中转兜底**）。
 * 这份 ICE 与 `/api/device/config` 下发给 agent 的那份**必须同源**，
 * 否则两端打洞参数不一致。
 *
 * 来源：旧 `GET /api/console/ext/p2p-signal` 的**设备密钥分支**。
 * 该文件里 `POST { adminKey }`（往边车注令牌）是**第三套鉴权**（站点 adminKey，
 * 与用户会话、设备密钥都无关），属运维入口，**不属任何一条轴**，
 * 暂留在旧路径（详见加减归档 §待决）。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import crypto from "node:crypto";
import { getMonitorConfig } from "$lib/server/console-ext.js";
import { guardDevice } from "$lib/server/guard-device.js";

const SIGNAL_URL = (process.env.STELARITH_P2P_URL || "http://127.0.0.1:18110").replace(/\/+$/, "");
/** 下发给浏览器/教室机的**公网**信令地址；必须与 SIGNAL_URL（内部回环）分离。 */
const PUBLIC_URL = (process.env.STELARITH_P2P_PUBLIC_URL || "").replace(/\/+$/, "");
const ADMIN_KEY = (process.env.STELARITH_P2P_ADMIN_KEY || "").trim();
const HMAC_KEY = (
	process.env.STELARITH_P2P_HMAC_KEY ||
	process.env.CIMS_ADMIN_SECRET ||
	""
).trim();

function mintSecret(uid: string): string {
	if (!HMAC_KEY) throw new Error("STELARITH_P2P_HMAC_KEY 未配置");
	return crypto.createHmac("sha256", HMAC_KEY).update(`p2p:${uid}`).digest("hex");
}

async function registerToSidecar(uid: string, secret: string): Promise<void> {
	try {
		await fetch(`${SIGNAL_URL}/register-device`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ admin_key: ADMIN_KEY, deviceUid: uid, secret })
		});
	} catch {
		/* 边车没起：忽略，不阻塞取令牌 */
	}
}

export async function GET(event: RequestEvent) {
	const g = guardDevice(event);
	if ("error" in g) return g.error;

	const uid = String(event.url.searchParams.get("uid") ?? "").trim();
	if (!uid) return json({ error: "missing uid" }, { status: 400 });
	if (!HMAC_KEY) return json({ error: "服务端未配置 HMAC 密钥" }, { status: 500 });

	const secret = mintSecret(uid);
	await registerToSidecar(uid, secret);

	const mc = await getMonitorConfig();
	const iceRaw = String(mc.p2p_ice_override ?? "").trim();
	let iceServers: unknown[] = [
		{ urls: "stun:stun.miwifi.com:3478" },
		{ urls: "stun:stun.chat.bilibili.com:3478" }
	];
	if (iceRaw) {
		try {
			const parsed = JSON.parse(iceRaw);
			if (Array.isArray(parsed) && parsed.length > 0) iceServers = parsed;
		} catch {
			/* 非法 JSON 忽略，回退默认 */
		}
	}

	return json({
		signalUrl: PUBLIC_URL || SIGNAL_URL,
		roomId: `room-${uid}`,
		secret,
		iceServers,
		expiresIn: 0
	});
}
