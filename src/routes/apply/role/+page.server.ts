import { verifyToken } from "$lib/server/auth.js";
import { targetOptions, listMyRoleRequests, PROOF_TYPES } from "$lib/server/role-requests.js";
import { roleToLevel, ROLE_LABELS, LEVEL_LABELS, LEVEL_DESCRIPTIONS } from "$lib/permissions.js";
import type { Role, Level } from "$lib/permissions.js";
import type { PageServerLoad } from "./$types";

/**
 * 权限晋升申请页的数据装载。
 *
 * 依工程约定（`PLAN-3batches.md`）：公开页数据一律走 load，不在 onMount 里 fetch ——
 * 这样首屏就带上「当前等级 / 可申请目标 / 历史申请」，不会先渲染空表单再跳变。
 */
export const load: PageServerLoad = ({ cookies }) => {
	const user = verifyToken(cookies.get("admin_token"));
	if (!user) {
		return { loggedIn: false, me: null, targets: [], proofTypes: PROOF_TYPES, requests: [] };
	}

	const role = user.role as Role;
	const level = roleToLevel(role);

	return {
		loggedIn: true,
		me: {
			username: user.username,
			role,
			roleLabel: ROLE_LABELS[role] ?? role,
			level,
			levelLabel: level === null ? "未知" : LEVEL_LABELS[level as Level],
			levelDescription: level === null ? "" : LEVEL_DESCRIPTIONS[level as Level],
			className: (user as any).className || "",
			gradeName: (user as any).gradeName || ""
		},
		// 只有「上一级」的角色可用（逐级晋升由服务端再校验一次，前端这份仅用于渲染下拉）。
		// 与 `/api/role-requests?scope=mine` **共用** targetOptions()：
		// 曾经两处各拼一份（接口裸字符串 vs 页面富对象），同一字段两种形状，
		// 前端按一种解析就必然打挂另一种。单一来源后不会再漂移。
		targets: targetOptions(role),
		proofTypes: PROOF_TYPES,
		requests: listMyRoleRequests(user.username)
	};
};
