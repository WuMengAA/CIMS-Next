/**
 * OAuth 授权端点（GET 展示登录/同意页，POST 处理登录与同意）。
 *
 * 设计：未登录时在此内联登录（复用网站 verifyLogin/makeToken，登录后即为网站会话），
 * 已登录（携带有效 admin_token Cookie）时直接展示同意页 —— 从而「复用网站会话」。
 */

import type { PageServerLoad, Actions } from "./$types";
import { fail, redirect } from "@sveltejs/kit";
import { verifyToken, verifyLogin, makeToken, markLogin } from "$lib/server/auth.js";
import {
	validateClient,
	validateRedirectUri,
	issueCode,
	OAUTH_CLIENT_ID
} from "$lib/server/oauth.js";

function q(params: URLSearchParams, key: string): string {
	return (params.get(key) ?? "").trim();
}

function buildQuery(clientId: string, redirectUri: string, state: string): string {
	return new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		state,
		response_type: "code"
	}).toString();
}

export const load: PageServerLoad = async ({ url, cookies }) => {
	const client_id = q(url.searchParams, "client_id");
	const redirect_uri = q(url.searchParams, "redirect_uri");
	const state = q(url.searchParams, "state");
	const response_type = q(url.searchParams, "response_type") || "code";

	const base = { client_id, redirect_uri, state, response_type };

	if (response_type !== "code") return { ...base, authed: false, user: null, error: "unsupported_response_type" };
	if (client_id !== OAUTH_CLIENT_ID) return { ...base, authed: false, user: null, error: "unauthorized_client" };
	if (!validateRedirectUri(redirect_uri)) return { ...base, authed: false, user: null, error: "invalid_redirect_uri" };

	const u = verifyToken(cookies.get("admin_token"));
	if (!u) return { ...base, authed: false, user: null, error: null };

	return {
		...base,
		authed: true,
		user: { username: u.username, displayName: u.displayName, role: u.role },
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

		if (client_id !== OAUTH_CLIENT_ID || !validateRedirectUri(redirect_uri)) {
			return fail(400, { error: "invalid_client", client_id, redirect_uri, state });
		}

		const user = verifyLogin(username, password);
		if (!user) {
			return fail(401, { error: "用户名或密码错误", client_id, redirect_uri, state });
		}

		let ip = "";
		try {
			ip = getClientAddress();
		} catch {
			/* noop */
		}
		const ua = request.headers.get("user-agent") || "";
		cookies.set("admin_token", makeToken(user, { ip, userAgent: ua }), {
			path: "/",
			httpOnly: true,
			sameSite: "strict",
			secure: false,
			maxAge: 30 * 24 * 60 * 60
		});
		markLogin(user.username, ip);

		// 回到 authorize（GET），load 将看到已登录 → 展示同意页
		throw redirect(303, `/oauth/authorize?${buildQuery(client_id, redirect_uri, state)}`);
	},

	// 已登录用户点击「授权」
	consent: async ({ request, cookies }) => {
		const form = await request.formData();
		const client_id = String(form.get("client_id") ?? "");
		const redirect_uri = String(form.get("redirect_uri") ?? "");
		const state = String(form.get("state") ?? "");

		// 登录态丢失 → 回到登录步骤
		const u = verifyToken(cookies.get("admin_token"));
		if (!u) {
			throw redirect(303, `/oauth/authorize?${buildQuery(client_id, redirect_uri, state)}`);
		}
		if (client_id !== OAUTH_CLIENT_ID || !validateRedirectUri(redirect_uri)) {
			return fail(400, { error: "invalid_client" });
		}

		const code = issueCode(u.id ?? -1, client_id, redirect_uri, state);
		const sep = redirect_uri.includes("?") ? "&" : "?";
		throw redirect(302, `${redirect_uri}${sep}code=${code}&state=${encodeURIComponent(state)}`);
	}
};
