/**
 * 按需取某个客户端的 client_secret（后台参考页「显示」按钮用）。
 *
 * 为什么不把 secret 直接塞进页面数据：SvelteKit 会把页面 props 序列化进 HTML
 * 供 hydration，所以「页面上打码」只是视觉层的遮挡 —— 密钥照样躺在页面源码里
 * （浏览器扩展、投屏、保存的页面都能读）。要真的不露，就得让它不出现在首屏 HTML 里，
 * 只在明确点了「显示」时单独取一次。
 *
 * 门槛与页面一致：manageOAuth（第三方登录授权）。
 */

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { verifyToken } from "$lib/server/auth.js";
import { userCan } from "$lib/permissions.js";
import { getClient, clientSecret, hasSecret, type OAuthClientRecord } from "$lib/server/oauth-clients.js";

async function currentUser(request: Request) {
	const token = request.headers.get("cookie")?.match(/admin_token=([^;]+)/)?.[1] || "";
	return await verifyToken(token);
}

export const GET: RequestHandler = async ({ params, request }) => {
	const u = await currentUser(request);
	if (!u) return json({ error: "未登录" }, { status: 401 });
	if (!userCan(u, "manageOAuth")) return json({ error: "需要站长权限" }, { status: 403 });

	const rec: OAuthClientRecord | null = await getClient(params.id);
	if (!rec) return json({ error: "未登记的客户端" }, { status: 404 });

	return json({ id: rec.id, secret: clientSecret(rec), configured: hasSecret(rec) });
};
