import { redirect } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { userCan, canDevice, canDeviceAction, isConsoleReadOnly } from "$lib/permissions.js";
import { getCimsAccount } from "$lib/server/cims-account.js";
import type { PageServerLoad } from "./$types";

// 设备页（Svelte 版，2026-09-26 从原生面板迁移）：与集控面板同门槛 viewConsole，
// 服务端把角色 + 设备轴权限位 + 操作账户下发，前端据此渲染（只读态隐藏写按钮）。
export const load: PageServerLoad = async ({ cookies }: { cookies: import("@sveltejs/kit").Cookies }) => {
	const u = await verifyToken(cookies.get("admin_token") ?? "");
	if (!u || !userCan(u, "viewConsole")) throw redirect(303, "/admin/login");
	const account = await getCimsAccount();
	return {
		role: u.role,
		readonly: isConsoleReadOnly(u.role),
		user: u.displayName || u.username,
		accountId: account?.id ?? "",
		can: {
			control: canDevice(u.role, "control"),
			remote: canDevice(u.role, "remote"),
			manage: canDevice(u.role, "manage"),
			// 传文件（2026-09-29 补）：老师/班主任/电教委员/站长都有 file 位，
			// 与「设备控制」不是同一档 —— 老师没有 control 也要能往本班发文件。
			// 前端用它渲染「发文件」按钮，服务端 file-push 分支再独立强制一次。
			// 注意用 canDeviceAction（动作轴）而非 canDevice（档位轴）：file 是动作
			// 不是档位，写成 canDevice(role,"file") 会因档位表里没有 file 而恒为 false，
			// 把按钮对所有人藏掉。
			file: canDeviceAction(u.role, "file"),
		},
	};
};
