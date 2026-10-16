/**
 * 设备绑定（2026-10-06）：登录用户给一台设备签发「设备接入票」。
 *
 * 背景：被控端 OOBE 里点「用星璃账号绑定」→ 走完 OAuth 授权 → 拿着 websiteToken
 * 来换一张**设备接入票**。这张票写进被控端的 agent.env（代替手填云端设备令牌），
 * 被控端连云端时带票 + 设备指纹，云端验票放行。全程零手填。
 *
 * 设备票格式：`v1.<expMs>.<devUidB64>.<fpB64>.<nonce>.<ownerB64>.<sig>`（7 段）
 *   - 与 viewer 票（5 段）同密钥（CLOUD_VIEWER_SECRET）、同 HMAC-SHA256，
 *     但段数不同 ⇒ 云端按段数区分两种票，互不混用。
 *   - 签名内容 = 前 6 段用 `.` 连接。
 *   - exp 默认 30 天：票泄露也只在这段时间内可用，且被控端重连时还会带 fp 对照。
 *
 * 安全边界（想清楚了的）：
 *   1. 只要求「星璃账号登录态」——任何一个实名账号都能给自己名下的设备发接入票。
 *      这是设计意图：接入不再依赖谁泄露/抄送设备令牌，绑定即授权、账号即审计。
 *   2. 票里带 owner（绑定者用户名）→ 云端注册事件能查到「哪台设备是谁绑进来的」。
 *   3. CLOUD_VIEWER_SECRET 没配 → 拒绝签发（不许假装通过），返回 503。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import crypto from "node:crypto";
import { env } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import { verifyToken } from "$lib/server/auth.js";

const TICKET_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const SECRET = env.CLOUD_VIEWER_SECRET || "";
const b64u = (b: Buffer) => Buffer.from(b).toString("base64url");

function signDeviceTicket(devUid: string, fp: string, owner: string): string | null {
	if (!SECRET) return null;
	const exp = Date.now() + TICKET_TTL_MS;
	const nonce = crypto.randomBytes(8).toString("hex");
	const payload =
		`v1.${exp}.${b64u(Buffer.from(devUid, "utf8"))}.${b64u(Buffer.from(fp, "utf8"))}.` +
		`${nonce}.${b64u(Buffer.from(owner, "utf8"))}`;
	const sig = b64u(crypto.createHmac("sha256", SECRET).update(payload).digest());
	return `${payload}.${sig}`;
}

export function GET(event: RequestEvent) {
	const auth = event.request.headers.get("authorization") ?? "";
	const m = /^Bearer\s+(.+)$/i.exec(auth);
	if (!m) return json({ error: "需要 Bearer 网站会话令牌（先走 OAuth 授权）" }, { status: 401 });
	const user = verifyToken(m[1].trim());
	if (!user) return json({ error: "登录会话无效或已过期，请重新登录" }, { status: 401 });

	const fp = String(event.url.searchParams.get("fp") ?? "").trim().toLowerCase();
	if (!fp || !/^[a-z0-9_\-]{8,64}$/.test(fp))
		return json({ error: "缺 fp 或格式不对（8-64 位小写字母数字_-）" }, { status: 400 });

	const rawUid = String(event.url.searchParams.get("uid") ?? "").trim();
	// 设备名：优先调用方给的名字，不给则站点生成（稳定、可预期）
	const devUid = rawUid || `user${user.id}-dev${fp.replace(/[^a-z0-9]/g, "").slice(0, 8)}`;
	const owner = String(user.username || user.displayName || `user#${user.id ?? "?"}`);

	const ticket = signDeviceTicket(devUid, fp, owner);
	if (!ticket)
		return json({ error: "云端票据密钥未配置（CLOUD_VIEWER_SECRET），设备绑定通道关闭" }, { status: 503 });

	// 这里**不再**给设备签发 OAuth 客户端（clientId/clientSecret）。
	// 原因：被控端绑定走的是公开 loopback 客户端 xjk_device_public（RFC 8252，
	// 不设密钥），授权码流程本身就能走通；再签一对设备专属密钥，设备端既不会用，
	// 也等于多一份要落盘的秘密。设备真正的"自动生成凭据"就是下面这张设备票。
	console.log(`[device/bind] ${owner} 绑定设备 ${devUid}（fp=${fp.slice(0, 8)}…）`);
	return json({
		ok: true,
		ticket,
		wsUrl: (publicEnv.PUBLIC_CLOUD_WS_URL || "").trim() || null,
		uid: devUid,
		owner,
		expiresInSec: Math.floor(TICKET_TTL_MS / 1000),
	});
}
