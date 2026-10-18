/**
 * /admin/library —— 附件库总览（跨账号）。
 *
 * 个人附件库是「每个账号各存各的」，但运营需要回答两个问题：
 * 谁快满了？谁的空间该扩？这里就是那个答案。
 * ⚠️ 这里是全站唯一能跨账号访问 attachments 的地方，改代码前先想清楚。
 */
import { redirect } from "@sveltejs/kit";
import type { PageServerLoad, Actions } from "./$types";
import { sessionUser } from "$lib/server/session.js";
import { userCan } from "$lib/permissions.js";
import { adminUsageOverview, adminSetBonusQuota, type AdminUserUsage } from "$lib/server/attachment-library.js";
import { r2Configured } from "$lib/server/storage/r2.js";

export const load: PageServerLoad = async ({ cookies }) => {
	const user = await sessionUser({ cookies });
	if (!user) throw redirect(303, "/admin/login");
	if (!userCan(user, "manageStorage")) throw redirect(303, "/admin");

	return {
		rows: await adminUsageOverview(),
		configured: r2Configured()
	};
};

export const actions: Actions = {
	/** 给某人追加额外配额（MiB）。0 = 撤销额外配额，回到纯等级容量。 */
	async bonus({ request, cookies }) {
		const user = await sessionUser({ cookies });
		if (!user) return { ok: false, error: "未登录" };
		if (!userCan(user, "manageStorage")) return { ok: false, error: "无权操作" };
		const form = await request.formData();
		const id = Number(form.get("userId"));
		const mib = Number(form.get("mib"));
		if (!Number.isFinite(id) || id <= 0) return { ok: false, error: "用户不存在" };
		await adminSetBonusQuota(id, mib);
		return { ok: true, id, mib };
	}
};
