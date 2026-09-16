import { verifyToken } from "$lib/server/auth.js";
import { can, roleLevelLabel, canDevice, roleDeviceTiers, isConsoleReadOnly } from "$lib/permissions.js";
import type { PageServerLoad } from "./$types";

/**
 * 权限总览页：把「五级 × 功能」与「设备权限轴」两套模型摊开给用户看。
 *
 * 之所以做成页面而非写死在文档里：权限模型会演进，文档必然漂移；
 * 这里的数据全部由 permissions.ts 的纯函数实时推导，改一处即全站同步。
 *
 * 访问门槛用 viewConsole（L2+，访客禁止）而非 managePermissions（L5）：
 * 每个登录用户都该看得清「自己现在能做什么、还差什么」，只有"改权限"
 * 才需要站长身份 —— 而本页是只读展示，没有写操作。
 */
export const load: PageServerLoad = async ({ cookies }) => {
	const u = verifyToken(cookies.get("admin_token") ?? "");
	return {
		role: u?.role ?? null,
		levelLabel: u ? roleLevelLabel(u.role) : "未登录",
		deviceTiers: u ? roleDeviceTiers(u.role) : [],
		readonlyConsole: u ? isConsoleReadOnly(u.role) : true,
		// 当前用户的设备权限位快照（与集控面板下发的口径一致）
		device: {
			watch: u ? canDevice(u.role, "watch") : false,
			control: u ? canDevice(u.role, "control") : false,
			remote: u ? canDevice(u.role, "remote") : false,
			manage: u ? canDevice(u.role, "manage") : false
		},
		canManagePermissions: u ? can(u.role, "managePermissions") : false
	};
};
