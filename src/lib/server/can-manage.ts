// 内容条目的「管理权」判定 —— 纯函数，不依赖框架，可单独验证。
//
// 为什么要单独一个文件：原来它和 `verifyToken` 一起放在 `api-auth.ts` 里，
// 而 `api-auth.ts` 用 SvelteKit 的 `$lib` 别名 import 了框架侧模块，
// 导致这个纯逻辑**无法脱离 SvelteKit 单独跑测试**（守护用例写不出来）。
// 2026-10-03 抽出，并修掉其中的 fail-open。

import type { Role } from "$lib/permissions.js";

/** 站管：`owner` 与 `admin` 在权限模型里本是等价的（见 permissions.ts 的 ROLE_LABELS，两者都叫"站长"）。 */
function isStationMaster(role: string): boolean {
	return role === "admin" || role === "owner";
}

/**
 * 能不能**管理**这条内容（删除、改配置等写操作）。
 *
 * ⚠️ fail-closed：**无主条目（`owner` 为空）只有站管能管**。
 *
 * 旧实现是 `return !owner || owner === user.username` —— `!owner` 那一支
 * 让**任意登录用户**都能管理无主条目。实测站点 `content/docs/` 下 15 个文件有 **14 个没有 owner**，
 * 也就是任何登录用户都能删掉这 14 个文档。这就是本次修复的对象。
 *
 * 行为对照（修复前 → 修复后）：
 *   站管 / 任意条目      true  → true    （不变）
 *   普通用户 / 自己的条目 true  → true    （不变）
 *   普通用户 / 别人的条目 false → false   （不变）
 *   普通用户 / 无主条目   true  → **false**（本次收紧）
 *   未登录 / 任意条目     false → false   （不变）
 */
export function canManage(user: { username: string; role: string } | null, owner?: string): boolean {
	if (!user) return false;
	if (isStationMaster(user.role)) return true;
	if (!owner) return false;
	return owner === user.username;
}

/**
 * 能不能在**后台列表里看到**这条内容（只读语义、不是管理权）。
 *
 * 为什么单独一个函数：列表过滤不该用「管理权」判断 —— 否则一收紧，
 * 内容编辑就**看不见那 14 个无主文档**，等于修一个洞砸一个功能。
 * 可见性规则：站管看全部；其余人看「自己的 + 无主的（公共内容）」。
 */
export function canManageOrPublic(user: { username: string; role: string } | null, owner?: string): boolean {
	if (!user) return false;
	if (isStationMaster(user.role)) return true;
	if (!owner) return true; // 无主 = 公共内容，进得了后台的人都能看
	return owner === user.username;
}

/** 只为类型完整性 re-export，调用方不必从 permissions 再导一次。 */
export type { Role };
