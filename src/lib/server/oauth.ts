/**
 * OAuth2 授权码流程（网站作为授权服务器）。
 *
 * 用途：星集控桌面原生客户端（xingjikong）不再手输 CIMS 密码，而是拉起浏览器
 * 跳到本网站走「网站授权」：复用用户已有的网站会话（已登录则直接同意，未登录则
 * 在此登录），同意后回拨到桌面端的本地 loopback 端口换取**网站会话令牌**。
 *
 * 桌面端拿到的是网站会话令牌，之后所有 CIMS 调用都走网站已有的
 * `/api/console/cims/*` 服务端代理（复用其 RBAC 与特权 CIMS 会话），
 * 因此**完全不动 CIMS 后端**。
 *
 * 安全要点：
 * - 仅允许 loopback 回拨（`http://127.0.0.1:<port>/oauth-callback`，RFC 8252 原生应用实践）。
 * - authorization code 单次使用、5 分钟过期，存于进程内 Map。
 * - client_secret 来自环境变量 OAUTH_DESKTOP_SECRET（与桌面端常量一致）。
 */

import crypto from "node:crypto";
import { env } from "$env/dynamic/private";
import { makeToken, verifyToken, getUserById, type User } from "./auth.js";

/** 已注册的桌面客户端 ID（与原生客户端常量保持一致）。 */
export const OAUTH_CLIENT_ID = "xingjikong_native";

const SECRET = (env.OAUTH_DESKTOP_SECRET ?? "dev-xingjikong-secret-change-me").trim();
/** 允许回拨的路径后缀（桌面端本地监听）。 */
const REDIRECT_PATH = "/oauth-callback";
const CODE_TTL_MS = 5 * 60 * 1000;

interface CodeRecord {
	userId: number;
	clientId: string;
	redirectUri: string;
	state: string;
	exp: number;
}

const codes = new Map<string, CodeRecord>();

/** 定期清理过期 code，避免进程内 Map 无限增长。 */
function sweepExpired() {
	const now = Date.now();
	for (const [k, v] of codes) if (v.exp < now) codes.delete(k);
}
setInterval(sweepExpired, 60_000).unref?.();

export function validateClient(clientId: string, secret: string): boolean {
	return clientId === OAUTH_CLIENT_ID && secret === SECRET;
}

/** 仅允许 http://127.0.0.1 的 loopback 回拨（任意端口，RFC 8252）。 */
export function validateRedirectUri(uri: string): boolean {
	try {
		const u = new URL(uri);
		return (
			u.protocol === "http:" &&
			u.hostname === "127.0.0.1" &&
			u.pathname.endsWith(REDIRECT_PATH)
		);
	} catch {
		return false;
	}
}

function randomToken(n = 32): string {
	return crypto.randomBytes(n).toString("base64url");
}

export function issueCode(
	userId: number,
	clientId: string,
	redirectUri: string,
	state: string
): string {
	const code = randomToken(24);
	codes.set(code, { userId, clientId, redirectUri, state, exp: Date.now() + CODE_TTL_MS });
	return code;
}

/** 消费 code（单次使用 + 过期校验）。 */
export function consumeCode(code: string): CodeRecord | null {
	const rec = codes.get(code);
	if (!rec) return null;
	codes.delete(code);
	if (rec.exp < Date.now()) return null;
	return rec;
}

/** 为指定用户签发网站会话令牌（与网站登录拿到的令牌同构）。 */
export function mintWebsiteToken(
	user: User,
	meta: { ip?: string; userAgent?: string } = {}
): string {
	return makeToken(user, meta);
}

/** 调试用：仅当给定令牌有效时返回用户（代理侧复用）。 */
export function userFromWebsiteToken(token: string): User | null {
	return verifyToken(token);
}

/** 按 id 取用户（token 端点用）。 */
export function resolveUser(userId: number): User | null {
	return getUserById(userId);
}
