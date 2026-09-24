import { redirect } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { userCan, canDevice, roleLevelLabel, ROLE_LABELS } from "$lib/permissions.js";
import type { PageServerLoad } from "./$types";

// 老师页（T09 第一步）：手机竖屏形态，顶部「教室现在的画面」+ 三个零输入大按钮
// （拍照 / 发通知 / 关机），权限遵循服务端硬校验 —— 本页只做体验层门控。
//
// ⚠️ 设备三关铁律（#249）：teacher（任课教师）设备档为空，连 watch 都没有；
// 能拍照/关机的带班老师是 homeroom（班主任，watch/control/remote 全档）。
// 所以页面按 can.remote 门控拍照/关机按钮，无权限时禁用并说明原因，
// 服务端 requiredTier 仍硬校验（stelarith_task 下发 = remote 档，拦在代理层）。
export const load: PageServerLoad = async ({ cookies }) => {
	const u = verifyToken(cookies.get("admin_token") ?? "");
	if (!u || !userCan(u, "viewConsole")) throw redirect(303, "/admin/login");
	// 本页是「本班操作」入口：非站长必须已绑定班级，否则引导到绑班页（与面板同口径）。
	const needsClassBinding = !["owner", "admin"].includes(u.role) && !(u.className || "").trim();
	if (needsClassBinding) throw redirect(303, "/admin/console/bind");
	return {
		role: u.role,
		roleLabel: ROLE_LABELS[u.role] ?? "用户",
		levelLabel: roleLevelLabel(u.role),
		user: u.displayName || u.username,
		className: u.className || "",
		gradeName: u.gradeName || "",
		can: {
			// 看画面（教室现在的画面）→ watch 档；拍照/关机经 stelarith_task 下发 → remote 档。
			// 发通知 → 内容轴 broadcast（sendBroadcast 称号）或设备轴 control 档任一。
			watch: canDevice(u.role, "watch"),
			control: canDevice(u.role, "control"),
			remote: canDevice(u.role, "remote"),
			broadcast: userCan(u, "sendBroadcast") || canDevice(u.role, "control")
		}
	};
};
