/**
 * 被控轴 · 教室端部署配置（`GET /api/device/config`）
 *
 * 教室端应用首启时自动拉取，用来填 `agent-secret.cmd`：
 * 设备密钥 / P2P 信令地址 / P2P HMAC 密钥 / 站点公钥 / ICE 列表。
 *
 * ⚠️ 返回里含 `deviceSecret`，所以**必须满足二者之一**才放行（2026-10-01 拍板收窄，
 *    fail-closed，二者皆不满足 → 403 `device_secret_required`）：
 *   ① 请求头带有效设备密钥 `x-stelarith-device-secret`（已自举设备重新拉配置，
 *      用 `guardDevice` 校验）；
 *   ② query 带 `?code=<有效接入码>`（首启设备还没有密钥，用管理员生成的一次性
 *      接入码换取；接入码**只校验不消费**——见 `validateActivationCode`，同一个码
 *      要"先拉配置、再绑班"两步用，消费是 `/api/device/activate` 绑班的事）。
 *
 * ⚠️ 旧路径 `GET /api/console/ext/device-config` 仍免鉴权 —— 那是双轨期既有行为
 *    （旧 catch-all 原样保留），待旧路径退役后"明文可取 deviceSecret"的隐患
 *    才真正消除。
 *
 * 来源：旧 `GET /api/console/ext/device-config`（同一份实现）。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { getMonitorConfig, validateActivationCode } from "$lib/server/console-ext.js";
import { guardDevice } from "$lib/server/guard-device.js";

/** 站点公钥（Ed25519，验签用）。与旧实现同值。 */
const SITE_PUBKEY =
	"-----BEGIN PUBLIC KEY-----MCowBQYDK2VwAyEA+ANF5sMoA1Fe5BXlQKZHU5kTlgEAKFD4zRNWXIjMrOc=-----END PUBLIC KEY-----";

export async function GET(event: RequestEvent) {
	// 门控（fail-closed）：有效设备密钥 **或** 有效接入码，二者皆无 → 403。
	// 接入码路径只校验不消费（绑班才消费），已自举设备走密钥路径重拉。
	const g = guardDevice(event);
	if ("error" in g) {
		const code = String(event.url.searchParams.get("code") ?? "");
		if (!await validateActivationCode(code)) return g.error;
	}
	// p2pIce：与 `/api/console/control/p2p-token` 下发给浏览器的那份同源，
	// agent 端 `STELARITH_P2P_ICE` 用同一份，两端才能互相打洞/中转。
	const mc = await getMonitorConfig();
	const iceRaw = String(mc.p2p_ice_override ?? "").trim();
	let p2pIce: unknown[] = [
		{ urls: "stun:stun.miwifi.com:3478" },
		{ urls: "stun:stun.chat.bilibili.com:3478" }
	];
	if (iceRaw) {
		try {
			const parsed = JSON.parse(iceRaw);
			if (Array.isArray(parsed) && parsed.length > 0) p2pIce = parsed;
		} catch {
			/* 非法 JSON 忽略，回退默认 */
		}
	}
	return json({
		deviceSecret: process.env.CONSOLE_DEVICE_REPORT_SECRET ?? "",
		p2pSignal: process.env.STELARITH_P2P_PUBLIC_URL || process.env.STELARITH_P2P_URL || "",
		p2pSecret: process.env.STELARITH_P2P_HMAC_KEY ?? "",
		sitePubkey: SITE_PUBKEY,
		p2pIce: JSON.stringify(p2pIce)
	});
}
