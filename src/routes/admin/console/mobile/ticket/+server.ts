import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { verifyToken } from "$lib/server/auth.js";
import { userCan } from "$lib/permissions.js";
import { mintViewerTicket, VIEWER_TICKET_TTL_MS } from "$lib/server/cloud-ticket.js";
import type { RequestHandler } from "./$types";

// 云端 /ws/viewer 的接入票据（2026-10-03 加鉴权后新增）。
//
// 为什么多这一跳：浏览器直连云端，若把长期令牌下发到浏览器，F12 就能抄走，等于没鉴权。
// 所以改成：本页（已登录 + 已过 viewConsole）向本站服务端要一张 2 分钟有效的短票，
// 云端用同一个密钥 CLOUD_VIEWER_SECRET 验签。票只在握手时用，重连时再取一张新的。
export const GET: RequestHandler = async ({ cookies }) => {
	const u = verifyToken(cookies.get("admin_token") ?? "");
	if (!u || !userCan(u, "viewConsole")) {
		return json({ ok: false, error: "未登录或无查看集控权限" }, { status: 401 });
	}

	const r = mintViewerTicket(u.username, (env.CLOUD_VIEWER_SECRET ?? "").trim());
	if (!r.ok) {
		// 不许给空票假装成功——那会让页面连上去又被云端拒，不如这里说清楚
		return json({ ok: false, error: r.error }, { status: 500 });
	}

	return json({ ok: true, ticket: r.ticket, exp: r.exp, ttlMs: VIEWER_TICKET_TTL_MS });
};
