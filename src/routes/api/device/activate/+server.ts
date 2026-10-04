/**
 * 被控轴 · 设备接入码消费（`POST /api/device/activate?code=<码>&uid=<设备 uid>`）
 *
 * 教室端首次接入时用它把自己绑到一个班。
 *
 * **本端点是全被控轴唯一的例外**：首次接入的设备**还没有设备密钥**，
 * 所以允许"无密钥消费" —— 授权来自**接入码本身**（管理员生成、绑班级、一次性、带 TTL）。
 * 这符合两轴铁律的精神：密钥不是唯一凭证时，就必须有另一个**等价强度**的凭证顶上，
 * 而不是"没密钥所以放行"。
 *
 * 若调用方**带了**密钥但密钥不对 → 直接 403，不允许"带着错密钥反而绕过去"。
 *
 * 来源：旧 `GET /api/console/ext/device-activate?code=...`（消费分支）。
 * ⚠️ 方法从 GET 改为 POST：消费是**写操作**（码是一次性的，调用即销毁）。
 * 旧 GET 保留可用（双轨），新轴不再提供 GET 形态。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { consumeActivationCode } from "$lib/server/console-ext.js";
import { recordDeviceBinding } from "$lib/server/device-bindings.js";
import { deviceSecretOf, deviceSecretOk, deviceForbidden } from "$lib/server/guard-device.js";

export async function POST(event: RequestEvent) {
	// 带了密钥就必须是对的（不允许"错密钥"被当成"没密钥"）。
	const secret = deviceSecretOf(event);
	if (secret && !deviceSecretOk(event)) return deviceForbidden();

	const url = event.url;
	let code = String(url.searchParams.get("code") ?? "").trim();
	let uid = String(url.searchParams.get("uid") ?? "").trim();

	// 也接受 body 形态（POST 的自然写法）；query 优先，保持与旧客户端兼容。
	if (!code || !uid) {
		try {
			const body = await event.request.json();
			if (body && typeof body === "object") {
				code = code || String((body as Record<string, unknown>).code ?? "").trim();
				uid = uid || String((body as Record<string, unknown>).uid ?? "").trim();
			}
		} catch {
			/* 无 body 或非 JSON：沿用 query 里的值 */
		}
	}

	if (!code) return json({ error: "缺少接入码" }, { status: 400 });
	if (!uid) return json({ error: "缺少 uid 参数" }, { status: 400 });

	const item = consumeActivationCode(code, uid);
	if (!item) return json({ error: "接入码无效或已过期" }, { status: 404 });
	// 消费成功即**落库**设备↔班级（站点自持真源，见 device-bindings.ts）。
	// 这一步此前缺失：码上只写了 usedBy，机器归了哪个班查不到、不可审计。
	// fail-soft：登记失败不阻断接入（recordDeviceBinding 内部吞异常）。
	recordDeviceBinding({ uid, classId: item.classId, className: item.className, boundBy: "activation-code" });
	return json({ ok: true, classId: item.classId, className: item.className, uid });
}
