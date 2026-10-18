/**
 * OAuth2 授权码流程（网站作为授权服务器）。
 *
 * 用途有两个客户端：
 * 1. 星集控桌面原生客户端（xingjikong）：不再手输 CIMS 密码，而是拉起浏览器跳到这里
 *    走「网站授权」，同意后回拨到桌面端的 loopback 端口换取**网站会话令牌**；
 *    之后所有 CIMS 调用都走网站已有的 `/api/console/cims/*` 服务端代理
 *    （复用其 RBAC 与特权 CIMS 会话），因此完全不动 CIMS 后端。
 * 2. VoiceHub 校园广播站：标准 OAuth2 三件套（authorize / token / userinfo），
 *    换到的是同一个网站会话令牌，VoiceHub 用它调 `/oauth/userinfo` 拿用户资料。
 *
 * 客户端白名单与密钥解析在 oauth-clients.ts：
 * - 只接受登记过的 client_id + 登记过的回拨地址（Web 精确匹配；原生走 127.0.0.1）；
 * - authorization code 单次使用、5 分钟过期，存于进程内 Map。
 *
 * 已知边界：code 存在进程内存里 → 换令牌必须落在同一进程（本站是单实例
 * adapter-node，够用）；进程重启会丢掉尚未兑换的 code，用户重走一次授权即可。
 */

import crypto from "node:crypto";
import { makeToken, verifyToken, getUserById, type User } from "./auth.js";
import {
	getClient,
	validateClient as validateClientInRegistry,
	validateRedirectUri as validateRedirectInRegistry,
	type OAuthClientRecord
} from "./oauth-clients.js";

export type { OAuthClientRecord };

const CODE_TTL_MS = 5 * 60 * 1000;

interface CodeRecord {
	userId: number;
	clientId: string;
	redirectUri: string;
	state: string;
	scope: string;
	exp: number;
}

const codes = new Map<string, CodeRecord>();

/** 定期清理过期 code，避免进程内 Map 无限增长。 */
function sweepExpired() {
	const now = Date.now();
	for (const [k, v] of codes) if (v.exp < now) codes.delete(k);
}
setInterval(sweepExpired, 60_000).unref?.();

/** 客户端是否存在且密钥匹配。 */
export async function validateClient(clientId: string, secret: string): Promise<boolean> {
	return await validateClientInRegistry(clientId, secret);
}

/** 回拨地址是否属于该客户端。传 client_id 字符串也接受，未知客户端一律拒绝。 */
export async function validateRedirectUri(clientId: string, uri: string): Promise<boolean> {
	const rec = await getClient(clientId);
	return !!rec && validateRedirectInRegistry(rec, uri);
}

function randomToken(n = 32): string {
	return crypto.randomBytes(n).toString("base64url");
}

export function issueCode(
	userId: number,
	clientId: string,
	redirectUri: string,
	state: string,
	scope = ""
): string {
	const code = randomToken(24);
	codes.set(code, { userId, clientId, redirectUri, state, scope, exp: Date.now() + CODE_TTL_MS });
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
export async function mintWebsiteToken(
	user: User,
	meta: { ip?: string; userAgent?: string; ttlDays?: number } = {}
): Promise<string> {
	return await makeToken(user, meta);
}

/** 调试用：仅当给定令牌有效时返回用户（代理侧复用）。 */
export async function userFromWebsiteToken(token: string): Promise<User | null> {
	return await verifyToken(token);
}

/** 按 id 取用户（token 端点用）。 */
export async function resolveUser(userId: number): Promise<User | null> {
	return await getUserById(userId);
}
