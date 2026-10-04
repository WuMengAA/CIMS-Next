/**
 * 运维轴 · P2P 令牌注入（`POST /api/ops/p2p-register`）
 *
 * 这是**第三种鉴权**（运维轴）：既不是控制轴的用户会话，也不是被控轴的
 * 设备密钥，而是站点级运维密钥 `STELARITH_P2P_ADMIN_KEY`（body 里传
 * `adminKey`，`crypto.timingSafeEqual` 恒时比对）—— 它属于**运维入口**，
 * 用于把某台设备的 P2P media secret 注入信令边车 `/register-device`
 * （确定性 HMAC 派生，见 `mintSecret`）。故单独落在 `/api/ops/**` 前缀下，
 * 与两条用户/设备轴划清界限。
 *
 * 实现原样搬自旧 `POST /api/console/ext/p2p-signal`（同 env 读取、同比对、
 * 同边车协议）。旧路径的 adminKey POST **原样保留** —— 那是双轨期既有行为，
 * 待旧路径退役后此处成为唯一运维入口。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import crypto from "node:crypto";

const SIGNAL_URL = (process.env.STELARITH_P2P_URL || "http://127.0.0.1:18110").replace(/\/+$/, "");
const ADMIN_KEY = (process.env.STELARITH_P2P_ADMIN_KEY || "").trim();
const HMAC_KEY = (process.env.STELARITH_P2P_HMAC_KEY || process.env.CIMS_ADMIN_SECRET || "").trim();

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
