/**
 * OAuth token 端点：用 authorization code 换取网站会话令牌。
 *
 * 客户端拿到该令牌后：
 * - 桌面端：作为 Bearer 调 `/api/console/cims/*` 代理（复用 RBAC）；
 * - VoiceHub：调 `/oauth/userinfo` 拿用户资料。
 *
 * 返回体同时给 `access_token` 与 `token` 两个键，是刻意的历史兼容：
 * 桌面端读的是 `token`（最早那版就这么写的，且已装在用户机器上），
 * VoiceHub 走标准 OAuth2 读 `access_token`。两者是同一个令牌，
 * 多一个键不增加任何能力，却省掉「改完还得重新发一版桌面端」的往返。
 */

import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { validateClient, consumeCode, mintWebsiteToken, resolveUser } from "$lib/server/oauth.js";

/** 会话有效期（秒）：默认 30 天，客户端登录时可选 60/120 天（2026-09-27 安全改造）。 */
const DEFAULT_EXPIRES_IN = 30 * 24 * 60 * 60;

function clampExpiresIn(raw: string | null | undefined): number {
	const n = Number(raw ?? "");
	if (!Number.isFinite(n) || n <= 0) return DEFAULT_EXPIRES_IN;
	const days = Math.min(Math.max(Math.round(n / 86400), 1), 365);
	return days * 24 * 60 * 60;
}

/** 统一的排查日志前缀，便于 `grep oauth/token` 过滤。 */
function log(msg: string): void {
	console.log(`[oauth/token] ${msg}`);
}

function toParams(request: Request, body: string): URLSearchParams {
	const params = new URLSearchParams();
	const ct = request.headers.get("content-type") ?? "";
	if (ct.includes("application/x-www-form-urlencoded")) {
		for (const [k, v] of new URLSearchParams(body)) params.set(k, v);
	} else {
		try {
			const j = JSON.parse(body) as Record<string, unknown>;
			for (const [k, v] of Object.entries(j)) if (v != null) params.set(k, String(v));
		} catch {
			/* 忽略：交由后续校验 */
		}
	}
	// RFC 6749 §2.3.1：凭据也可以走 HTTP Basic（客户端可能只实现这一种）。
	if (!params.get("client_secret")) {
		const m = /^Basic\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
		if (m) {
			const [id, secret] = Buffer.from(m[1], "base64").toString("utf8").split(":");
			if (id && !params.get("client_id")) params.set("client_id", decodeURIComponent(id));
			if (secret) params.set("client_secret", decodeURIComponent(secret));
		}
	}
	return params;
}

export const POST: RequestHandler = async ({ request }) => {
	const raw = await request.text();
	const p = toParams(request, raw);

	const grant_type = p.get("grant_type");
	const code = p.get("code") ?? "";
	const client_id = p.get("client_id") ?? "";
	const client_secret = p.get("client_secret") ?? "";
	const redirect_uri = p.get("redirect_uri") ?? "";

	// 失败时客户端只会看到「授权失败，无法获取访问令牌」（VoiceHub 把真实原因吞在自己的
	// 服务端日志里），现场极难排查。这里把每次请求的判定结果打到 stdout，
	// 排查时 `grep oauth/token stelarith.out.log` 即可。
	// 只记「有没有值」，绝不打印密钥与令牌本身。
	log(
		`收到：grant_type=${grant_type ?? "(空)"} client_id=${client_id || "(空)"} 带密钥=${client_secret ? "是" : "否"} 带回拨=${redirect_uri ? "是" : "否"} code长度=${code.length}`
	);

	if (grant_type !== "authorization_code") {
		log(`拒绝：grant_type 不是 authorization_code（拿到 ${grant_type ?? "空"}）`);
		throw error(400, "unsupported_grant_type");
	}
	if (!await validateClient(client_id, client_secret)) {
		log(`拒绝：客户端校验不通过 client_id=${client_id || "(空)"} → 密钥不匹配，或该 client_id 未登记`);
		throw error(401, "invalid_client");
	}

	const rec = consumeCode(code);
	if (!rec) {
		log("拒绝：code 不存在、已被用过或已过期");
		throw error(400, "invalid_grant");
	}
	if (rec.clientId !== client_id || rec.redirectUri !== redirect_uri) {
		log(
			`拒绝：与授权时不一致（client_id 一致=${rec.clientId === client_id} 回拨一致=${rec.redirectUri === redirect_uri}）\n` +
				`  授权时=${rec.redirectUri}\n  本次=${redirect_uri}`
		);
		throw error(400, "invalid_grant");
	}

	const user = await resolveUser(rec.userId);
	if (!user) {
		log(`拒绝：授权用户 id=${rec.userId} 已不存在`);
		throw error(400, "invalid_grant");
	}

	const ttlSecs = clampExpiresIn(p.get("expires_in"));
	// 登录软件信息（2026-09-27 安全改造）：OAuth 换令牌时记录来源 UA，
	// 后台活动页据此显示"星集控桌面端 / 网页浏览器"等登录来源。
	const ua = request.headers.get("user-agent") ?? "";
	const token = await mintWebsiteToken(user, { ttlDays: ttlSecs / 86400, userAgent: ua });
	log(`签发成功：client_id=${client_id} 用户=${(await user).username} scope=${rec.scope || "profile"} ttl=${ttlSecs}s`);
	return json({
		access_token: token,
		token_type: "Bearer",
		expires_in: ttlSecs,
		scope: rec.scope || "profile",
		// 兼容桌面端：它读的是这个键
		token
	});
};
