/**
 * OAuth token 端点：用 authorization code 换取网站会话令牌。
 *
 * 桌面端拿到该令牌后，作为 Bearer 调 `/api/console/cims/*` 代理（复用 RBAC）。
 */

import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
	validateClient,
	consumeCode,
	mintWebsiteToken,
	resolveUser
} from "$lib/server/oauth.js";

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

	if (grant_type !== "authorization_code") throw error(400, "unsupported_grant_type");
	if (!validateClient(client_id, client_secret)) throw error(401, "invalid_client");

	const rec = consumeCode(code);
	if (!rec) throw error(400, "invalid_grant");
	if (rec.clientId !== client_id || rec.redirectUri !== redirect_uri) {
		throw error(400, "invalid_grant");
	}

	const user = resolveUser(rec.userId);
	if (!user) throw error(400, "invalid_grant");

	const token = mintWebsiteToken(user);
	return json({ token, token_type: "Bearer", scope: "cims" });
};
