/**
 * 控制轴 · 某人功能开关的**覆盖值**（`/api/console/control/user-features`）
 *
 *   GET  — 查看某人被单独开/关的功能（管理员核对用）`?uid=`
 *   POST — 设置覆盖值：`true` 强制开 / `false` 强制关 / `null` 恢复按角色默认
 *
 * 权限：**设备管理档**（`canDevice(role,"manage")`）。
 * 给别人开/关功能等同于改权限 —— 普通老师不能给自己开
 * 「全屏通知」「关闭设备」这类会打断课堂或关掉机器的功能。
 *
 * 🚨 **旧实现在这里写错过一次**：用了 `userCan(u, "manage")`。
 * `manage` **不是**内容轴 `Action` 而是一个设备档位，`userCan` 对它**恒为 false**，
 * 把这条端点对所有人（含站长）永久 403 掉。正解是 `canDevice(u.role, "manage")`。
 * 本文件统一走 `guardControl(event, "manage")` —— 守卫内部用 `DEVICE_TIERS` 白名单
 * 分流到 `canDevice`，**从类型上就写不出这个错**。这正是把两轴收进守卫的理由。
 *
 * POST 只写白名单里的功能位（见 `setUserFeatureOverrides`），
 * 拼错的键不会留下"看起来设了其实没生效"的幽灵配置。
 *
 * 来源：旧 `GET/POST /api/console/ext/user-features`。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { getUserFeatureOverrides, setUserFeatureOverrides, addAudit } from "$lib/server/console-ext.js";
import { guardControl, readControlBody } from "$lib/server/guard-control.js";

export function GET(event: RequestEvent) {
	const g = guardControl(event, "manage");
	if ("error" in g) return g.error;

	const uid = String(event.url.searchParams.get("uid") ?? "").trim();
	if (!uid) return json({ error: "缺少 uid" }, { status: 400 });
	return json({ uid, overrides: getUserFeatureOverrides(uid) });
}

export async function POST(event: RequestEvent) {
	const g = guardControl(event, "manage");
	if ("error" in g) return g.error;
	const actor = g.user.displayName || g.user.username;

	const body = await readControlBody(event);
	const target = String(body.uid ?? "").trim();
	if (!target) return json({ error: "缺少 uid" }, { status: 400 });

	const patch =
		body.flags && typeof body.flags === "object" && !Array.isArray(body.flags)
			? (body.flags as Record<string, unknown>)
			: {};

	const saved = setUserFeatureOverrides(target, patch, actor);
	addAudit({
		actor,
		role: g.user.role,
		action: "feature.set",
		target,
		detail: JSON.stringify(patch).slice(0, 200)
	});
	return json({ ok: true, uid: target, overrides: saved });
}
