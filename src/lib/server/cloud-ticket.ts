// 云端 /ws/viewer 接入票据的签发（纯函数，不依赖 SvelteKit 运行时，方便单测）。
//
// 票格式必须与云端 stelarith-cloud-ws/src/ticket.js 完全一致，两边改任一边都要改另一边：
//   v1.<expMs>.<uid(base64url)>.<nonce>.<hmac(base64url)>
//   签名内容 = "v1.<expMs>.<uid>.<nonce>"，HMAC-SHA256(secret)
//
// 为什么不让浏览器直接拿长期令牌：浏览器拿什么都能被 F12 抄走，
// 令牌一泄露就是永久泄露；短票只有 2 分钟，抄走也基本没用。

import { createHmac, randomBytes } from "node:crypto";

export const VIEWER_TICKET_TTL_MS = 120000; // 2 分钟：够页面连上并握手，不够被人拿去长期用

/**
 * 签一张管理端票据。密钥为空必须如实返回失败——不许给空票假装成功，
 * 那会让页面连上去又被云端拒，还不如在取票这一步就把原因说清楚。
 */
export function mintViewerTicket(
	uid: string,
	secret: string,
	ttlMs: number = VIEWER_TICKET_TTL_MS
): { ok: true; ticket: string; exp: number } | { ok: false; error: string } {
	const key = (secret ?? "").trim();
	if (!key) return { ok: false, error: "密钥为空，签不出票据（站点与云端需配同一个 CLOUD_VIEWER_SECRET）" };

	const exp = Date.now() + ttlMs;
	const nonce = randomBytes(8).toString("hex");
	const payload = `v1.${exp}.${Buffer.from(String(uid ?? ""), "utf8").toString("base64url")}.${nonce}`;
	const sig = createHmac("sha256", key).update(payload).digest("base64url");
	return { ok: true, ticket: `${payload}.${sig}`, exp };
}
