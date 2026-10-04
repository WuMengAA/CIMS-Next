import { redirect } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { userCan, canDevice, isConsoleReadOnly } from "$lib/permissions.js";
import { getCimsAccount } from "$lib/server/cims-account.js";
import type { PageServerLoad } from "./$types";

// 音量调节页（2026-10-02 从旧静态面板 views.volume 迁为 SvelteKit 真页）。
// 与「设备控制」同门槛：viewConsole + 设备 control 档才能下发。
// 设备列表经 /api/console/cims/class/device-status（服务端代理，按角色收敛范围）；
// 下发经 sign-task 签名 + send-notification 命令通道（stelarith_task: set_volume）。
export const load: PageServerLoad = async ({ cookies }: { cookies: import("@sveltejs/kit").Cookies }) => {
	const u = verifyToken(cookies.get("admin_token") ?? "");
	if (!u || !userCan(u, "viewConsole")) throw redirect(303, "/admin/login");
	const account = await getCimsAccount();
	return {
		role: u.role,
		readonly: isConsoleReadOnly(u.role),
		user: u.displayName || u.username,
		accountId: account?.id ?? "",
		can: {
			control: canDevice(u.role, "control"),
		},
	};
};
