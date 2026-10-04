/**
 * 被控轴 · 设备自注册 OAuth 客户端（`GET /api/device/oauth-register?fp=<设备指纹>`）
 *
 * 客户端首启携带设备指纹换取专属 `client_id` / `client_secret`。
 * 安全改造（2026-09）：**安装包不再内置公开密钥**，改为首启动态注册，幂等。
 *
 * 来源：旧 `GET /api/console/ext/oauth-register`（同一份实现）。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { registerDeviceClient } from "$lib/server/oauth-clients.js";
import { guardDevice } from "$lib/server/guard-device.js";

export function GET(event: RequestEvent) {
	const g = guardDevice(event);
	if ("error" in g) return g.error;

	const fp = String(event.url.searchParams.get("fp") ?? "").trim();
	if (!fp) return json({ error: "缺少 fp（设备指纹）" }, { status: 400 });

	try {
		const reg = registerDeviceClient(fp);
		return json({
			clientId: reg.clientId,
			clientSecret: reg.clientSecret,
			loopback: true,
			scopes: ["cims", "profile"]
		});
	} catch (e) {
		return json({ error: String((e as Error)?.message ?? e) }, { status: 400 });
	}
}
