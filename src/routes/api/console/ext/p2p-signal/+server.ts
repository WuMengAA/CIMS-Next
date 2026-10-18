import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { verifyToken, type User } from "$lib/server/auth.js";
import { can, userCan, canDevice } from "$lib/permissions.js";
import crypto from "node:crypto";
import { verifyDeviceReportSecret, getMonitorConfig } from "$lib/server/console-ext.js";

/**
 * 星集控 P2P 信令接缝（方案2 · 接入真实 CIMS 的信令边车）
 * ----------------------------------------------------------------
 * 主体职责：
 *   GET  /api/console/ext/p2p-signal?uid=<设备码>
 *        → 返回面板无感远控所需的 { signalUrl, roomId, secret }
 *        secret 由站点 HMAC 密钥 + 设备码确定性派生，无需新增存储；
 *        教室端被控程序用同一 (uid, 站点密钥) 派生，两端令牌天然一致。
 *        signalUrl 取公网地址 STELARITH_P2P_PUBLIC_URL（未配置则回退内部地址）。
 *   POST /api/console/ext/p2p-signal  body { uid, adminKey }
 *        → 把该设备的 media secret 注入信令边车（受 STELARITH_P2P_ADMIN_KEY 保护）。
 *
 * 权限：GET 需 device.remote 档位（看+控）；POST 需站点 adminKey，与用户会话无关。
 */

const SIGNAL_URL = (process.env.STELARITH_P2P_URL || "http://127.0.0.1:18110").replace(/\/+$/, "");
// 下发给浏览器/教室机的**公网**信令地址：必须与 SIGNAL_URL 分离。
// SIGNAL_URL 是服务端注入令牌用的内部地址（同机回环）；公网地址则经
// CIMS 8096（`<slug>.<zone>` → client app）的 /socket.io 透传落到同一个边车，
// 因此无需为信令单独新增 DNS/ingress。未配置时回退内部地址（仅同机可用）。
const PUBLIC_URL = (process.env.STELARITH_P2P_PUBLIC_URL || "").replace(/\/+$/, "");
const ADMIN_KEY = (process.env.STELARITH_P2P_ADMIN_KEY || "").trim();
const HMAC_KEY = (process.env.STELARITH_P2P_HMAC_KEY || process.env.CIMS_ADMIN_SECRET || "").trim();

async function authUser(event: RequestEvent): Promise<User | null> {
	const u = await verifyToken(event.cookies.get("admin_token"));
	if (!u || typeof u.id !== "number") return null;
	if (!userCan(u, "viewConsole")) return null;
	return u;
}

function mintSecret(uid: string): string {
	if (!HMAC_KEY) throw new Error("STELARITH_P2P_HMAC_KEY 未配置");
	return crypto.createHmac("sha256", HMAC_KEY).update(`p2p:${uid}`).digest("hex");
}

async function registerToSidecar(uid: string, secret: string): Promise<{ ok: boolean; status: number }> {
	try {
		const r = await fetch(`${SIGNAL_URL}/register-device`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ admin_key: ADMIN_KEY, deviceUid: uid, secret }),
		});
		return { ok: r.ok, status: r.status };
	} catch {
		return { ok: false, status: 0 };
	}
}

export async function GET(event: RequestEvent) {
	const uid = String(event.url.searchParams.get("uid") ?? "").trim();
	// 设备自注册：带 x-stelarith-device-secret 的是教室端 agent（无用户会话），
	// 密钥正确 + uid 非空即放行（令牌是确定性 HMAC 派生，本就与 uid 绑定）。
	const devSecret = event.request.headers.get("x-stelarith-device-secret");
	if (devSecret) {
		if (!verifyDeviceReportSecret(devSecret)) {
			return json({ error: "设备密钥无效" }, { status: 403 });
		}
		if (!uid) return json({ error: "missing uid" }, { status: 400 });
	} else {
		const u = await authUser(event);
		if (!u) return json({ error: "无权限" }, { status: 401 });
		if (!canDevice(u.role, "remote")) return json({ error: "需 device.remote 档位" }, { status: 403 });
	}
	if (!uid) return json({ error: "missing uid" }, { status: 400 });
	if (!uid) return json({ error: "missing uid" }, { status: 400 });
	if (!HMAC_KEY) return json({ error: "服务端未配置 HMAC 密钥" }, { status: 500 });
	const secret = mintSecret(uid);
	// 顺手把令牌注入边车（幂等；边车没起则忽略，不阻塞面板）
	await registerToSidecar(uid, secret);
	// ICE 服务器：优先取监控配置的 p2p_ice_override（管理员可填 TURN/STUN JSON 数组），
	// 留空回退默认 STUN（仅局域网/打洞可达；配了 TURN 才有 50kb/s 级中转兜底）。
	const mc = await getMonitorConfig();
	const iceRaw = String(mc.p2p_ice_override ?? "").trim();
	let iceServers = [
		{ urls: "stun:stun.miwifi.com:3478" },
		{ urls: "stun:stun.chat.bilibili.com:3478" },
	];
	if (iceRaw) {
		try {
			const parsed = JSON.parse(iceRaw);
			if (Array.isArray(parsed) && parsed.length > 0) iceServers = parsed;
		} catch { /* 非法 JSON 忽略，回退默认 */ }
	}
	return json({
		signalUrl: PUBLIC_URL || SIGNAL_URL,
		roomId: `room-${uid}`,
		secret,
		iceServers,
		expiresIn: 0, // 确定性派生，长期有效（教室机重连即用同一令牌）
	});
}

export async function POST(event: RequestEvent) {
	const body = await event.request.json().catch(() => ({}));
	const adminKey = String(body.adminKey || "").trim();
	if (!ADMIN_KEY || adminKey.length !== ADMIN_KEY.length) {
		return json({ error: "bad admin key" }, { status: 403 });
	}
	try {
		if (!crypto.timingSafeEqual(Buffer.from(adminKey), Buffer.from(ADMIN_KEY))) {
			return json({ error: "bad admin key" }, { status: 403 });
		}
	} catch {
		return json({ error: "bad admin key" }, { status: 403 });
	}
	const uid = String(body.uid || "").trim();
	if (!uid || !HMAC_KEY) return json({ error: "missing uid or HMAC key" }, { status: 400 });
	const res = await registerToSidecar(uid, mintSecret(uid));
	return json({ ok: res.ok, status: res.status });
}
