import { verifyToken } from "$lib/server/auth.js";
import type { Role } from "$lib/permissions.js";

export async function getApiUser(request: Request): Promise<{ username: string; role: Role } | null> {
	const cookie = request.headers.get("cookie");
	const token = cookie?.match(/admin_token=([^;]+)/)?.[1] || "";
	const user = await verifyToken(token);
	if (!user) return null;
	return { username: (await user).username, role: (await user).role };
}

// canManage 已抽到 can-manage.ts（纯函数、可脱离 SvelteKit 单测），这里 re-export 保持调用点不变。
// 2026-10-03 修复：原实现在 `owner` 为空时默认放行（fail-open），任意登录用户可管理无主条目；
// 详见 can-manage.ts 的注释与行为对照表。
export { canManage, canManageOrPublic } from "$lib/server/can-manage.js";