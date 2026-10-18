import { redirect } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { userCan } from "$lib/permissions.js";
import type { PageServerLoad } from "./$types";

// ClassIsland 教室端（SvelteKit 真页，2026-10-02 从旧原生面板 views.classisland 迁移）。
//
// 页面门槛与集控面板其它子页一致（viewConsole）。本页**纯只读**：只展示某台教室机
// 最后一次上报的真实运行状态（模块 / 插件 / 补充遥测），不下发任何指令。
// 下发类操作一律留在「设备控制」页与旧版面板，本页刻意不提供。
export const load: PageServerLoad = async ({ cookies }: { cookies: import("@sveltejs/kit").Cookies }) => {
	const u = await verifyToken(cookies.get("admin_token") ?? "");
	if (!u || !userCan(u, "viewConsole")) throw redirect(303, "/admin/login");
	return { user: u.displayName || u.username };
};
