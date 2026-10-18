import { redirect } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { userCan } from "$lib/permissions.js";
import type { PageServerLoad } from "./$types";

// 手机集控页（D6 · 2026-10-02）：复用站点账号，门槛与集控面板一致（viewConsole，L2+）。
// 浏览器直连云端 /ws/viewer（WS＋JPEG 截图定案路径，非 WebRTC），看教室画面 + 下发指令。
// 鉴权（2026-10-03 已补）：云端要求第一条消息是 auth，浏览器用的短票由 ./ticket/+server.ts
//   现签（2 分钟有效，密钥 CLOUD_VIEWER_SECRET 站点与云端共用）。本页门槛仍是 viewConsole（L2+）。
export const load: PageServerLoad = async ({ cookies }) => {
	const u = await verifyToken(cookies.get("admin_token") ?? "");
	if (!u || !userCan(u, "viewConsole")) throw redirect(303, "/admin/login");
	return {
		role: u.role,
		user: u.displayName || u.username,
		// 仅下发"能否控制设备"的提示位（UI 体验层，服务端 WS 暂不强制，见上注）。
		canControl: true
	};
};
