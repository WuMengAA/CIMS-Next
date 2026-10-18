/**
 * OAuth 授权端点（GET 展示登录/同意页，POST 处理登录与同意）。
 *
 * 设计：未登录时在此内联登录（复用网站 verifyLogin/makeToken，登录后即为网站会话），
 * 已登录（携带有效 admin_token Cookie）时直接展示同意页 —— 从而「复用网站会话」。
 *
 * 多客户端：client_id / 回拨地址 / 密钥都在 oauth-clients.ts 里判定，
 * 本文件只负责「拿到一个合法的 client 记录 → 走登录或同意」。
 *
 * 关于免登：主站 www.245959623.xyz 与 voicehub.245959623.xyz 同属 245959623.xyz，
 * 对浏览器而言是 same-site —— admin_token 虽然是 SameSite=Strict，
 * 从 VoiceHub 顶级跳转过来仍会带上，所以已登录用户会直接看到同意页。
 */

import type { PageServerLoad, Actions } from "./$types";
import { fail, redirect } from "@sveltejs/kit";
import { verifyToken, verifyLogin, makeToken, markLogin } from "$lib/server/auth.js";
import {
	getClient,
	validateRedirectUri,
	resolveScope,
	hasSecret,
	type OAuthClientRecord
} from "$lib/server/oauth-clients.js";
import { issueCode } from "$lib/server/oauth.js";

function q(params: URLSearchParams, key: string): string {
	return (params.get(key) ?? "").trim();
}

function buildQuery(clientId: string, redirectUri: string, state: string, scope = ""): string {
	const p: Record<string, string> = {
		client_id: clientId,
		redirect_uri: redirectUri,
		state,
		response_type: "code"
	};
	if (scope) p.scope = scope;
	return new URLSearchParams(p).toString();
}

/**
 * 授权前的四道闸：客户端登记 → 未被停用 → 回拨地址登记 → 密钥已配置。
 * 密钥没配也要挡在这里：否则用户一路同意到底，最后在换令牌那步失败，
 * 现场只会看到「登录失败」，排查成本远高于当场说清楚。
 * 停用单独一道：站长能在不删配置的前提下掐断某个第三方登录，
 * 且卡片上会明说「已停用」，不用去翻日志。
 */
async function inspect(
	clientId: string,
	redirectUri: string,
	scope: string
): Promise<{ error: string } | { client: OAuthClientRecord; scope: string }> {
	const client = await getClient(clientId);
	if (!client) return { error: "unauthorized_client" };
	if (client.enabled === false) return { error: "client_disabled" };
	if (!await validateRedirectUri(client, redirectUri)) return { error: "invalid_redirect_uri" };
	if (!hasSecret(client)) return { error: "client_not_configured" };
	return { client, scope: resolveScope(client, scope) };
}

function cookieOptions() {
	return {
		path: "/",
		httpOnly: true,
		sameSite: "strict" as const,
		// 与 /api/auth 登录保持同一口径（原来这里写死 false，会把已经在用 Secure 的
		// 生产会话降级成非 Secure Cookie，等于从授权页登录一次就把安全性拉低一档）。
		secure: process.env.COOKIE_SECURE === "true",
		maxAge: 30 * 24 * 60 * 60
	};
}

export const load: PageServerLoad = async ({ url, cookies }) => {
	const client_id = q(url.searchParams, "client_id");
	const redirect_uri = q(url.searchParams, "redirect_uri");
	const state = q(url.searchParams, "state");
	const scope = q(url.searchParams, "scope");
	const response_type = q(url.searchParams, "response_type") || "code";

	const base = { client_id, redirect_uri, state, scope, response_type, client: null };

	if (response_type !== "code") {
		return { ...base, authed: false, user: null, error: "unsupported_response_type" };
	}

	const probed = await inspect(client_id, redirect_uri, scope);
	if ("error" in probed) return { ...base, authed: false, user: null, error: probed.error };
	const { client } = probed;

	const u = await verifyToken(cookies.get("admin_token"));
	if (!u) return { ...base, client, authed: false, user: null, error: null };

	return {
		...base,
		client,
		authed: true,
		user: {
			username: u.username,
			displayName: u.displayName,
			role: u.role,
			avatar: u.avatar || ""
		},
		error: null
	};
};

export const actions: Actions = {
	// 未登录时在此登录（创建网站会话）
	login: async ({ request, cookies, getClientAddress }) => {
		const form = await request.formData();
		const username = String(form.get("username") ?? "").trim();
		const password = String(form.get("password") ?? "");
		const client_id = String(form.get("client_id") ?? "");
		const redirect_uri = String(form.get("redirect_uri") ?? "");
		const state = String(form.get("state") ?? "");
		const scope = String(form.get("scope") ?? "");

		const probed = await inspect(client_id, redirect_uri, scope);
		if ("error" in probed) {
			return fail(400, { error: "invalid_client", client_id, redirect_uri, state, scope });
		}

		const user = await verifyLogin(username, password);
		if (!user) {
			return fail(401, { error: "用户名或密码错误", client_id, redirect_uri, state, scope });
		}

		let ip = "";
		try {
			ip = getClientAddress();
		} catch {
			/* noop */
		}
		const ua = request.headers.get("user-agent") || "";
		cookies.set("admin_token", await makeToken(user, { ip, userAgent: ua }), cookieOptions());
		await markLogin(user.username, ip);

		// 回到 authorize（GET），load 将看到已登录 → 展示同意页
		throw redirect(303, `/oauth/authorize?${buildQuery(client_id, redirect_uri, state, probed.scope)}`);
	},

	// 已登录用户点击「授权」
	consent: async ({ request, cookies }) => {
		const form = await request.formData();
		const client_id = String(form.get("client_id") ?? "");
		const redirect_uri = String(form.get("redirect_uri") ?? "");
		const state = String(form.get("state") ?? "");
		const scope = String(form.get("scope") ?? "");

		// 登录态丢失 → 回到登录步骤
		const u = await verifyToken(cookies.get("admin_token"));
		if (!u) {
			throw redirect(303, `/oauth/authorize?${buildQuery(client_id, redirect_uri, state, scope)}`);
		}

		const probed = await inspect(client_id, redirect_uri, scope);
		if ("error" in probed) return fail(400, { error: probed.error });

		const code = issueCode(u.id ?? -1, client_id, redirect_uri, state, probed.scope);
		const sep = redirect_uri.includes("?") ? "&" : "?";
		throw redirect(302, `${redirect_uri}${sep}code=${code}&state=${encodeURIComponent(state)}`);
	}
};
