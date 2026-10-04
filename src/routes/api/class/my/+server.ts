/**
 * 班级域 · 我的班级绑定（`GET /api/class/my`）
 *
 * 2026-10-04（班级域收口）：从 `/api/console/control/my-classes` 迁来，
 * 旧路由保留 301 重定向。老师 / 班主任 / 电教委员的面板按它渲染**可选目标**
 * （发通知、传文件的目标下拉）。
 *
 * 权威来源是 `user_class_bindings` 里的**真实 `class_id`**，
 * 不是用户资料里的自由文本 `className` —— 后者表达不了"老师带两个班"。
 *
 * 来源：旧 `GET /api/console/ext/my-classes`。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { listBindings } from "$lib/server/class-scope.js";
import { guardControl } from "$lib/server/guard-control.js";

export function GET(event: RequestEvent) {
	const g = guardControl(event);
	if ("error" in g) return g.error;
	return json({ classes: listBindings(g.user.id) });
}
