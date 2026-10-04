/**
 * 控制轴 · P2P 信令令牌（`GET /api/console/control/p2p-token?uid=<设备码>`）
 *
 * 浏览器（老师/技术员）取自己那一份 WebRTC 信令凭据，用于连信令边车并拉起远控。
 *
 * 与被控轴 `GET /api/device/p2p-token` 的关系：
 *   · **两面同源、一码一钥**：令牌都是 `HMAC-SHA256(HMAC_KEY, "p2p:<uid>")` 的 hex，
 *     所以浏览器与教室端被控程序各自算出来的**天然一致**，无需共享存储。
 *   · 差别只在**鉴权与权限**：本端点走用户会话 + `remote` 档位；被控轴走设备密钥。
 *     这正是两轴分离要达成的形态 —— 同一份数据、两个方向、各自的门。
 *
 * 权限：`guardControl(event, "remote")`。远程屏幕控制是敏感能力（能看能操作），
 * 只给 owner/admin/homeroom/techrep（见 `permissions.ts` 的 ROLE_DEVICE）。
 *
 * 来源：旧 `GET /api/console/ext/p2p-signal` 的**用户会话分支**（本轮 A4.3 前置补齐）。
 * 旧端点原样保留（双轨期）；`POST {adminKey}` 那半是第三套鉴权的运维口，
 * 已迁到 `/api/ops/p2p-register`（A12）。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import crypto from "node:crypto";
import { getMonitorConfig } from "$lib/server/console-ext.js";
import { guardControl } from "$lib/server/guard-control.js";

/** 服务端注入令牌用的**内部**地址（同机回环）。 */
const SIGNAL_URL = (process.env.STELARITH_P2P_URL || "http://127.0.0.1:18110").replace(/\/+$/, "");
/**
 * 下发给浏览器的**公网**信令地址。必须与 SIGNAL_URL 分离：
 * 公网地址经 CIMS 8096（`<slug>.<zone>` → client app）的 `/socket.io` 透传落到同一个边车，
 * 因此无需为信令单独新增 DNS/ingress。未配置时回退内部地址（仅同机可用）。
 */
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

/** 顺手把令牌注入信令边车（幂等）。边车没起就忽略 —— 不阻塞取令牌。 */
async function registerToSidecar(uid: string, secret: string): Promise<void> {
	try {
		await fetch(`${SIGNAL_URL}/register-device`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ admin_key: ADMIN_KEY, deviceUid: uid, secret })
		});
	} catch {
		/* 忽略 */
	}
}

export async function GET(event: RequestEvent) {
	const g = guardControl(event, "remote");
	if ("error" in g) return g.error;

	const uid = String(event.url.searchParams.get("uid") ?? "").trim();
	if (!uid) return json({ error: "missing uid" }, { status: 400 });
	if (!HMAC_KEY) return json({ error: "服务端未配置 HMAC 密钥" }, { status: 500 });

	const secret = mintSecret(uid);
	await registerToSidecar(uid, secret);

	// ICE：优先取监控配置的 `p2p_ice_override`（管理员可填 TURN/STUN JSON 数组），
	// 留空回退默认 STUN。**必须与被控轴 `/api/device/p2p-token` 同源** ——
	// 两端打洞参数不一致就协商不起来。
	const mc = getMonitorConfig();
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
		expiresIn: 0 // 确定性派生，长期有效（教室机重连即用同一令牌）
	});
}
