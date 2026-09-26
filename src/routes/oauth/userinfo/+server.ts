/**
 * OAuth userinfo 端点（RFC 7662 风格的资源端点，简化版）。
 *
 * 客户端（VoiceHub）拿 access_token 来这里换用户资料：
 *   GET /oauth/userinfo
 *   Authorization: Bearer <access_token>
 *
 * 返回字段刻意给足别名（id/sub、name/display_name、avatar/picture），
 * 这样 VoiceHub 后台即便不逐项配置「字段映射」，靠它的兜底探测也能直接跑通。
 *
 * 安全：这里返回的是「登录用户是谁」，除邮箱与头像外不含任何管理数据。
 * 令牌本身就是网站会话令牌，权限判定仍由各自 API 端点（如 /api/console/cims/*）负责，
 * 也就是说 —— 拿到 userinfo 不等于拿到后台权限。
 */

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { userFromWebsiteToken } from "$lib/server/oauth.js";
import { publicBaseUrl, defaultAvatarUrl } from "$lib/server/oauth-clients.js";
import { sanitizeAvatar } from "$lib/server/auth.js";

function bearerOf(request: Request): string {
	const m = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
	return m ? m[1].trim() : "";
}

function unauthorized(reason: string) {
	return json(
		{ error: "invalid_token", error_description: reason },
		{ status: 401, headers: { "WWW-Authenticate": `Bearer error="invalid_token"` } }
	);
}

export const GET: RequestHandler = async ({ request, url }) => {
	const token = bearerOf(request) || (url.searchParams.get("access_token") ?? "").trim();
	if (!token) {
		console.log("[oauth/userinfo] 拒绝：没带 access_token");
		return unauthorized("缺少 access_token");
	}

	const u = userFromWebsiteToken(token);
	if (!u) {
		console.log("[oauth/userinfo] 拒绝：access_token 无效或已过期");
		return unauthorized("令牌无效或已过期");
	}

	const base = publicBaseUrl();
	const fallback = defaultAvatarUrl();
	const rawAvatar = (u.avatar ?? "").trim();
	// 头像取值规整一律走 sanitizeAvatar 三段式标准（http(s) 原样 / 站内绝对路径原样 /
	// 脏值归空串，见 auth.ts）。此处额外补充两点：
	//   1. 站内绝对路径（/...）必须补上站点域名，否则客户端会以「自己的域名」为基准解析，必然 404；
	//   2. 取不到可用头像（空值或历史脏值）时回落站内默认头像，而不是给空串——
	//      空串会把回落责任丢给客户端，各家做法不一（有的显示首字母，有的整块空白）。
	const avatar =
		!rawAvatar || !sanitizeAvatar(rawAvatar)
			? fallback
			: rawAvatar.startsWith("/")
				? `${base}${rawAvatar}`
				: rawAvatar;

	const name = u.displayName || u.username;
	const id = String(u.id ?? "");

	console.log(
		`[oauth/userinfo] 成功：用户=${u.username} 头像=${avatar === fallback ? "默认" : avatar ? "有" : "空"}`
	);

	return json({
		sub: id,
		id,
		username: u.username,
		preferred_username: u.username,
		name,
		display_name: name,
		nickname: name,
		email: u.email || "",
		avatar,
		picture: avatar,
		role: u.role,
		issuer: base
	});
};
