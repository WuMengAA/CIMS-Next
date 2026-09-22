import { redirect } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { can, userCan, canDevice, isConsoleReadOnly, roleLevelLabel, allowedBroadcastScopes } from "$lib/permissions.js";
import { getCimsAccount } from "$lib/server/cims-account.js";
import type { PageServerLoad } from "./$types";

// 集控面板子页面：仅对具备 viewConsole 的角色开放（L2+：站长/编辑/审核员/电教委员/注册用户）。
// L1 只读访客已被 can(viewConsole) 挡在门外（门槛 2026-09-16 由 L1 提到 L2）。
// 浏览器不持有 CIMS 凭据——对 CIMS 的调用统一经 /api/console/cims 服务端代理。
// 这里同时把「角色 + 已解算的权限位」下发给面板，使面板能按权限禁用/隐藏操作，
// 而不是让只读账号也看到一屏可点但会被服务端拒绝的按钮。
export const load: PageServerLoad = async ({ cookies }) => {
	const u = verifyToken(cookies.get("admin_token") ?? "");
	if (!u || !userCan(u, "viewConsole")) throw redirect(303, "/admin/login");
	// 班级绑定校验：进入集控面板前必须完成班级/年级绑定（集控是设备管理入口，
	// 账号必须知道自己属于哪个班才能定位设备归属）。未绑定 → 引导到绑定页完成二次绑定。
	// 站长（owner/admin）管理全校设备，不强制绑定单个班级。
	const needsClassBinding = !["owner", "admin"].includes(u.role) && !(u.className || "").trim();
	if (needsClassBinding) throw redirect(303, "/admin/console/bind");
	// 取 CIMS 首个账户的 id，注入面板作为操作上下文（否则内嵌态 accountId 为空、
	// canUseBackend() 恒 false，所有 cims() 静默降级演示数据）。
	const account = await getCimsAccount();
	// 权限位分两条轴解算：
	//  - 内容轴（levelLabel / canEditContent）走 can()，决定面板里"内容/治理"入口；
	//  - 设备轴（control/remote/manage）走 canDevice()，与等级正交 ——
	//    电教委员内容等级只有 L2，但 remote 为真；站长等级最高，设备位仍单独判定。
	// 只读态（readonly）单独下发，让面板能整体切换为"观看模式"（隐藏所有写按钮）。
	return {
		role: u.role,
		levelLabel: roleLevelLabel(u.role),
		readonly: isConsoleReadOnly(u.role),
		user: u.displayName || u.username,
		// 全权接入 website 账号信息：把当前登录用户完整资料下发面板。
		// 面板内嵌态与宿主同源，还会实时拉一次 /api/me 校准；这里先给一批即时的，
		// 让顶栏身份区在首帧即可渲染（不依赖异步请求）。
		email: u.email || "",
		avatar: u.avatar || "",
		bio: u.bio || "",
		className: u.className || "",
		gradeName: u.gradeName || "",
		can: {
			control: canDevice(u.role, "control"),
			remote: canDevice(u.role, "remote"),
			manage: canDevice(u.role, "manage"),
			issue: userCan(u, "submitIssue"),
			// 广播位：内容轴 sendBroadcast（称号）或设备轴 control 档任一。
			// 设备三关铁律（#249）下 teacher 无 control，但仍须能发本班通知 → 广播走内容轴。
			broadcast: userCan(u, "sendBroadcast") || canDevice(u.role, "control")
		},
		// 广播可达范围（第三维度：能发 ≠ 能发多远）。
		// 面板据此只列出该账号可选的范围，避免「选了全校却被服务端 403」的挫败感。
		// 服务端仍会独立校验一次（前端只是体验层，不是安全边界）。
		broadcastScopes: allowedBroadcastScopes(u.role),
		// 当前用户 id：面板用它拼一对一私聊房间名（dm:<小id>:<大id>）。
		// 只下发 id 本身，不含任何凭据；好友关系仍由服务端按会话用户校验。
		userId: u.id,
		accountId: account?.id ?? ""
	};
};
