/**
 * 桌面管理端（Qt viewer）的云端接入票签发。
 *
 * 和 /api/console/mobile/ticket 的区别只有一件事：**有效期**。
 *   - 浏览器那个页面是"打开才连、断就重连"，2 分钟票足够，票被抄走也只有 2 分钟窗口；
 *   - 桌面端是**常驻程序**，开机自启、一挂就是几十天。给它 2 分钟票等于每 2 分钟
 *     要求用户重新走一次授权，教室场景不可接受。
 * 所以这里签一张与网站会话等长（默认 30 天）的票，走用户已同意的那条 OAuth 会话令牌。
 *
 * 信任链（只看这一段就够了）：
 *   ① Authorization: Bearer <网站会话令牌> —— 由 /oauth/token 签发，站点的 verifyToken 验；
 *   ② 用户必须过 viewConsole（否则任何人拿个令牌就能连云端看全机房）；
 *   ③ 票用同一个 CLOUD_VIEWER_SECRET 签，云端 verifyViewerTicket 验 —— 桌面端直接把它塞进
 *      WS 握手就能连，云端**零改动**（cloud-ws/src/index.js 的 authorizeViewer 一直收 msg.ticket）。
 *
 * 已知边界（说清楚，别当成已经解决了）：
 *   - 这张票一旦签发，我们在服务端没有"单独吊销"的能力 —— 换 CLOUD_VIEWER_SECRET 或改密码
 *     会让下一张票签不出来，但**已经出去的旧票仍然有效**。想掐断连接就换密钥。
 *   - 桌面端把它明文存在本机 AppData 目录下（跟原来 viewer.env 里的静态令牌一个强度，
 *     但多了一层"是谁在连"的 uid 审计）。
 *   - 密钥没配（CLOUD_VIEWER_SECRET 空）必须 500 说清楚：那才是真漏洞，不许签空票假装成功。
 */

import { json, error } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { verifyToken } from "$lib/server/auth.js";
import { userCan } from "$lib/permissions.js";
import { mintViewerTicket } from "$lib/server/cloud-ticket.js";
import type { RequestHandler } from "./$types";

/** 上限也是默认值：桌面端一次登录长期有效，与网站会话同长。 */
const DESKTOP_TICKET_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 只认 Bearer，且必须非空的令牌 —— 免得把"没带令牌"伪装成"令牌不对"。 */
function bearerOf(authorization: string | null): string {
	const m = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
	return (m?.[1] ?? "").trim();
}

export const POST: RequestHandler = async ({ request }) => {
	const secretToken = bearerOf(request.headers.get("authorization"));
	if (!secretToken) throw error(401, "缺少 Authorization: Bearer <网站会话令牌>");

	// ① 会话令牌必须是本站签的，且还没过期
	const u = await verifyToken(secretToken);
	if (!u) throw error(401, "网站会话已失效，请在管理端重新登录");
	// ② 权限：能看集控才配连管理端
	if (!userCan(u, "viewConsole")) throw error(403, "该账号没有查看集控的权限");

	// TTL 可运维覆盖（CLOUD_DESKTOP_TICKET_TTL_MS，毫秒），但绝不许超过 30 天 ——
	// 留个天花板，免得配置手滑写个 100 年。
	const raw = Number((env.CLOUD_DESKTOP_TICKET_TTL_MS ?? "").trim());
	const ttlMs =
		Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), DESKTOP_TICKET_TTL_MS) : DESKTOP_TICKET_TTL_MS;

	const r = mintViewerTicket(u.username, (env.CLOUD_VIEWER_SECRET ?? "").trim(), ttlMs);
	if (!r.ok) {
		// 密钥没配的话，桌面端每次开机都会卡在这里 —— 把原因原样带回去，别让它显示成"登录失败"
		throw error(500, r.error);
	}

	return json({
		ok: true,
		ticket: r.ticket,
		exp: r.exp,
		ttlMs,
		user: u.username
	});
};
