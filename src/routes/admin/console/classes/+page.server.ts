import { redirect } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { userCan, canDevice } from "$lib/permissions.js";
import type { PageServerLoad } from "./$types";

// 班级与审核页（集控面板内嵌子页，与 /admin/console/bind 同门槛 viewConsole，L2+）：
//   · 老师：看到「我的班级」及其审核态 —— 若 pending 则给出「班级审核中」提示；
//   · 管理员（设备 manage 档）：额外看到「待审队列」，含待审数量角标与通过/驳回操作。
// 班级实体与审核态以 CIMS 为权威（经 /api/console/cims 服务端代理转发）。
export const load: PageServerLoad = async ({ cookies }) => {
	const u = await verifyToken(cookies.get("admin_token") ?? "");
	if (!u || !userCan(u, "viewConsole")) throw redirect(303, "/admin/login");
	return {
		username: (await u).username,
		displayName: (await u).displayName || (await u).username,
		role: (await u).role,
		className: (await u).className || "",
		gradeName: (await u).gradeName || "",
		canReview: canDevice((await u).role, "manage"),
		canCreate: canDevice((await u).role, "control")
	};
};
