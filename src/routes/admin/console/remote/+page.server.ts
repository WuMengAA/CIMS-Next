import { redirect } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { userCan, canDevice } from "$lib/permissions.js";
import type { PageServerLoad } from "./$types";

// 远程控制页（Svelte 版，2026-10-02 从原生面板 static/console/remote-webrtc.html 迁移）。
//
// 这是集控里**唯一按设备档位（而非仅 viewConsole）设服务端页面门槛**的页：
// 远程屏幕控制能看能操作，属于敏感能力，只有持 `remote` 档的角色
// （owner/admin/homeroom，见 permissions.ts 的 ROLE_DEVICE）才能进入。
// 与写操作的二次强制一致：页面本身 303 挡下，取令牌端点再经 guardControl(event,"remote") 独立拦一次
// —— 前端门控只是体验层，不是安全边界。
//
// 不满足条件时，不留在本页静默降级，而是**重定向回集控概览**（该页会按 can.remote 显式禁用入口）。
// 未登录仍与兄弟页一致去登录页。
export const load: PageServerLoad = async ({ cookies }: { cookies: import("@sveltejs/kit").Cookies }) => {
	const u = verifyToken(cookies.get("admin_token") ?? "");
	if (!u) throw redirect(303, "/admin/login");
	if (!userCan(u, "viewConsole") || !canDevice(u.role, "remote")) throw redirect(303, "/admin/console");
	return {
		role: u.role,
		user: u.displayName || u.username,
		can: {
			remote: canDevice(u.role, "remote")
		}
	};
};
