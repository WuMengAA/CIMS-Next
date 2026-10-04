/**
 * 星集控 · **被控轴**统一守卫（2026-10-01 两轴分离）
 *
 * 两轴的定义（这是全项目唯一的权威说法，别再各自解释一遍）：
 *
 * | | 控制轴 | **被控轴（本文件）** |
 * |---|---|---|
 * | 方向 | 人 → 服务器 → 设备 | 设备 → 服务器 |
 * | 鉴权 | 用户会话 `Bearer` / `admin_token` | **设备密钥** `x-stelarith-device-secret` |
 * | 权限 | `DeviceAction` × 班级范围 | **无权限模型**，凭密钥即代表这台教室机 |
 * | 前缀 | `/api/console/**` | **`/api/device/**`** |
 * | 命中失败 | 401 / 403 | 403 `device_secret_required` |
 * | 调用方 | 网页控制台、控制端 App | 被控端 App / Rust agent |
 *
 * ## 本轴的三条铁律
 *
 * 1. **fail-closed，永不回落。** 密钥缺失、不匹配、或服务端未配置
 *    （`CONSOLE_DEVICE_REPORT_SECRET` 为空）→ 一律 **403**，绝不退到用户会话分支。
 *    旧 `/api/console/ext/[...path]` 里大量存在 `if (secret) {...} else { 用户鉴权 }`
 *    的串联写法 —— 它的副作用是把「设备密钥配错了」伪装成「登录过期」，
 *    两者排查方向完全相反（一个去查 `CONSOLE_DEVICE_REPORT_SECRET`/代理环境变量，
 *    一个去重新登录）。新轴不再允许这种歧义。
 *
 * 2. **一个路由文件只准有一条鉴权轴。** 本轴的任何 `+server.ts` 里
 *    出现 `verifyToken` / `canDevice` / `admin_token` 即为违规。
 *
 * 3. **设备自称的 uid 不可信。** 密钥是**部署级共享**的（全校设备同一把），
 *    所以 uid 由设备在 body/query 里自称。凡按 uid 写数据的端点，
 *    都必须**只在"发给这个 uid"的行上生效**（如 notice-ack 只更新发往该设备的
 *    投递行），使虚报 uid 顶多把自己的行提前标已读、拿不到任何别人的内容。
 *    这条约束在每个端点里各写一次，别指望守卫能替它把关。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { verifyDeviceReportSecret } from "$lib/server/console-ext.js";

/** 设备密钥请求头。名字改不得：Rust agent 与既有教室机都在用这个串。 */
export const DEVICE_SECRET_HEADER = "x-stelarith-device-secret";

/** 取请求携带的设备密钥（可能为 null）。 */
export function deviceSecretOf(event: RequestEvent): string | null {
	return event.request.headers.get(DEVICE_SECRET_HEADER);
}

/**
 * 设备密钥是否有效。
 *
 * ⚠️ 服务端未配置 `CONSOLE_DEVICE_REPORT_SECRET` 时，`verifyDeviceReportSecret`
 * 一律返回 false —— 即"未配置 = 拒绝一切设备"，这是刻意的 fail-closed。
 */
export function deviceSecretOk(event: RequestEvent): boolean {
	const secret = deviceSecretOf(event);
	if (!secret) return false;
	return verifyDeviceReportSecret(secret);
}

/** 统一的被控轴 403 响应。`detail` 给人看，`code` 给调用方判分支。 */
export function deviceForbidden(detail?: string): Response {
	return json(
		{
			error:
				detail ??
				"设备密钥无效：x-stelarith-device-secret 与服务端 CONSOLE_DEVICE_REPORT_SECRET 不一致（或服务端未配置，此时一律拒绝）",
			code: "device_secret_required"
		},
		{ status: 403 }
	);
}

/**
 * 被控轴入口守卫。
 *
 * 用法（每个被控轴路由的第一句）：
 * ```ts
 * const g = guardDevice(event);
 * if ("error" in g) return g.error;
 * ```
 *
 * 返回 `{ ok: true }` 而不是用户对象 —— 被控轴**没有身份**，
 * 只有一个"这台机器声称自己是某个 uid"的字符串，由各端点自己取。
 */
export function guardDevice(event: RequestEvent): { ok: true } | { error: Response } {
	if (!deviceSecretOk(event)) return { error: deviceForbidden() } as const;
	return { ok: true } as const;
}

/**
 * 读 JSON 请求体；解析失败一律回落成 `{}`（与旧路由同语义）。
 *
 * ⚠️ 注意一个**必须分开提示**的坑（旧路由踩过）：请求体若超过服务端
 * `BODY_SIZE_LIMIT`（adapter-node 默认 512 KiB），`request.json()` 会抛错、
 * 整体回落成 `{}`。对截图回传这类端点来说，这不是「设备没带 uid」，
 * 而是**整个报文被拒了**。所以各端点在字段缺失时要顺带判断 `Object.keys(body).length === 0`
 * 并给出"多半是报文超限"的提示，别把排查引到设备那一侧。
 */
export async function readDeviceBody(event: RequestEvent): Promise<Record<string, unknown>> {
	try {
		const v = await event.request.json();
		return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

/** 请求体是否"空到不正常"（用于上面那条 BODY_SIZE_LIMIT 提示）。 */
export function bodyLooksTruncated(body: Record<string, unknown>): boolean {
	return !body || Object.keys(body).length === 0;
}
