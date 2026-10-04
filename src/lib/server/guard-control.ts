/**
 * 星集控 · **控制轴**统一守卫（2026-10-01 两轴分离）
 *
 * 控制轴 = 人 → 服务器 → 设备。鉴权走**用户会话**，权限走**两道门**：
 *   ① 等级轴：能不能进集控面板（`viewConsole`）；
 *   ② 第二道门：按语义走**设备轴**（`canDevice(role, tier)`）或**内容轴**（`userCan(u, action)`）。
 *
 * ## ⚠️ 两条轴千万别混（这是本文件存在的最大理由）
 *
 * 设备档位 `watch` / `control` / `remote` / `manage` **不是** `Action`。
 * 写成 `userCan(u, "manage")` 会**恒为 false**，把端点对所有人（含站长）永久 403 掉 ——
 * 2026-10-01 在 `user-features` 端点实证过这一处。正确写法是
 * `canDevice(u.role, "manage")`。本守卫用 `DEVICE_TIERS` 白名单把这件事
 * **收进一个地方**：调用方只能选 `Action | DeviceTier | "broadcast"`，
 * 选错了在类型上就过不去，而不是线上 403 才被发现。
 *
 * ## 与旧路由的关系
 *
 * 本文件是把旧 `/api/console/ext/[...path]` 里的 `requestUser()` / `guard()`
 * 原样搬出来（语义逐行对齐，未改任何判定），供新的
 * `/api/console/control/**` 使用。旧路由**暂不改动**（双轨期），
 * 待其退役时自然消失。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { verifyToken, type User } from "$lib/server/auth.js";
import {
	userCan,
	canDevice,
	canDeviceAction,
	type Action,
	type DeviceTier,
	type DeviceAction
} from "$lib/permissions.js";

/**
 * 会话用户的可用形状：`User.id` 在类型上是**可选**的（兼容早期 JSON 存储），
 * 但走 `sessions JOIN users` 取出的会话用户必有 id，且控制轴的全部协作数据
 * （好友关系、会话发言权、操作审计）都以 id 为键。
 *
 * 在这里一次性收窄，好过每个调用点写 `u.id!` —— 也避免把 `undefined`
 * 静默传进按 id 查询的函数里（那种错在运行时只表现为"查不到"，最难查）。
 */
export type ConsoleUser = User & { id: number };

/** 设备档位白名单：用于区分第二道门走哪条轴。 */
const DEVICE_TIERS: DeviceTier[] = ["watch", "control", "remote", "manage"];

/**
 * 取请求用户：优先 `Authorization: Bearer`（控制端 App / CLI 自检），
 * 兜底 `admin_token` cookie（浏览器）。两路走同一套 `verifyToken` 会话校验，
 * Bearer 失效同样 401 —— 不会比 cookie 路径更宽。
 */
export function requestUser(event: RequestEvent): User | null {
	const bearer = event.request.headers.get("authorization") ?? "";
	if (/^Bearer\s+/i.test(bearer)) {
		const u = verifyToken(bearer.replace(/^Bearer\s+/i, "").trim());
		if (u) return u;
	}
	return verifyToken(event.cookies.get("admin_token"));
}

/**
 * 控制轴入口守卫。
 *
 * `need` 的三种归属：
 *   - `DeviceTier`（watch/control/remote/manage）→ 走**设备轴** `canDevice(role, need)`
 *   - `"broadcast"` → **复合位**：内容轴 `sendBroadcast`（称号）**或** 设备轴 `control` 任一即可
 *   - 其余 `Action` → 走**内容轴** `userCan(u, need)`
 *
 * 默认 `"viewConsole"`：只要求"能进集控面板"，与其余 console 读操作同档。
 */
export function guardControl(
	event: RequestEvent,
	need: Action | DeviceTier | "broadcast" = "viewConsole"
): { user: ConsoleUser } | { error: Response } {
	const u = requestUser(event);
	if (!u) return { error: json({ error: "请先登录" }, { status: 401 }) } as const;
	// 缺 id 时后续所有以 id 为键的操作都会静默失效，不如在这里明确拒绝。
	if (typeof u.id !== "number") {
		return { error: json({ error: "会话无效，请重新登录" }, { status: 401 }) } as const;
	}
	// 等级轴：必须能进集控面板。
	if (!userCan(u, "viewConsole")) {
		return { error: json({ error: "无权限" }, { status: 403 }) } as const;
	}
	// 第二道门按 need 的归属走对应轴（见上方 doc）。
	const ok =
		need === "broadcast"
			? userCan(u, "sendBroadcast") || canDevice(u.role, "control")
			: DEVICE_TIERS.includes(need as DeviceTier)
				? canDevice(u.role, need as DeviceTier)
				: userCan(u, need as Action);
	if (!ok) {
		return { error: json({ error: "无权限" }, { status: 403 }) } as const;
	}
	return { user: u as ConsoleUser } as const;
}

/** 读 JSON 请求体；解析失败回落 `{}`（与旧路由同语义）。 */
export async function readControlBody(event: RequestEvent): Promise<Record<string, unknown>> {
	try {
		const v = await event.request.json();
		return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

/**
 * 控制轴上**更细的一道门**：具体设备动作（`DeviceAction`，10 个）。
 *
 * ⚠️ 这是第 **三** 种权限形态 —— 原先我以为只有两种，直到写「传文件」时
 * svelte-check 把 `guardControl(event, "file")` 打回来（`"file"` 既不是 `Action`
 * 也不是 `DeviceTier`）才发现漏了一层。三种一起摆在下面，别再混：
 *
 * | # | 形态 | 判定函数 | 取值 |
 * |---|---|---|---|
 * | ① | 内容轴 Action | `userCan(u, a)` | viewConsole / submitIssue / chatClass / sendBroadcast … |
 * | ② | 设备轴 **Tier**（粗档） | `canDevice(role, t)` | watch / control / remote / manage |
 * | ③ | 设备轴 **Action**（细档） | `canDeviceAction(role, a)` | watch / playback / remote / voice / notify / **file** / shutdown / apps_view / apps_stop / logs_view |
 *
 * ⚠️ ② 与 ③ **会同名**（`watch`、`remote` 两处都有）但查的是**两张不同的角色表**
 * （`ROLE_DEVICE` / `ROLE_DEVICE_ACTIONS`），结果可能不同。
 * 所以不能把 ③ 塞进 ② 的白名单里"靠名字猜"，必须由调用方显式选 —— 这就是本函数
 * 与 `guardControl()` 分开存在的唯一理由。
 *
 * 典型用法：**传文件（`file`）** —— 粗档 control 表达不了
 * 「老师能传文件但不能监控」（teacher 的 `ROLE_DEVICE_ACTIONS` 只有 `file`），
 * 必须用细档。同理 `apps_view` / `apps_stop` / `logs_view` 也走这里。
 */
export function guardControlDeviceAction(
	event: RequestEvent,
	action: DeviceAction
): { user: ConsoleUser } | { error: Response } {
	const u = requestUser(event);
	if (!u) return { error: json({ error: "请先登录" }, { status: 401 }) } as const;
	if (typeof u.id !== "number") {
		return { error: json({ error: "会话无效，请重新登录" }, { status: 401 }) } as const;
	}
	if (!userCan(u, "viewConsole")) {
		return { error: json({ error: "无权限" }, { status: 403 }) } as const;
	}
	if (!canDeviceAction(u.role, action)) {
		return { error: json({ error: "无权限" }, { status: 403 }) } as const;
	}
	return { user: u as ConsoleUser } as const;
}
