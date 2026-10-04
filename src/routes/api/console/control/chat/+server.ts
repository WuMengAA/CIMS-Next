/**
 * 控制轴 · 班级/年级交流（`/api/console/control/chat`）
 *
 *   GET  — 按房间读消息（默认 `techrep-global`）
 *   POST — 发言；**重要消息自动升级为教室大屏广播**
 *
 * 权限：`chatClass`（内容轴 L2，注册电教委员即可）。
 *
 * 「@全体 投影坏了」这类口令会自动推到大屏，不必再切到通知页重敲一遍。
 *
 * ⚠️⚠️ **匹配式两个坑，都踩过，别改回去**：
 *   ① **不能给 `@全体` 加统一尾随 `\b`**：「体」是 CJK，而 JS 的 `\b` 只认
 *      ASCII 词字符边界，`/@(全体|all)\b/` 对「@全体 明天上课」**恒为 false** ——
 *      最常用的口令反而完全失效（实测只有 `@all` 分支能命中）。
 *      故 `@全体` 分支**不带** `\b`；只有需要防「@allen」这类英文误伤的 `@all` 才带。
 *   ② `@all` 还要防误伤邮箱（`a@all.com`）：用后行断言要求 `@` 前面
 *      不是邮箱本地部分的字符，这样「发给 x@all.org」不会被当成喊话。
 *
 * ⚠️ 房间语义 → 范围档之后**收敛**（而不是拒绝）：电教委员在全校群里喊 @全体，
 * 语义是全校但他只能发本班，于是**收敛为本班** ——
 * 既不让他替全校发言，也不让互助功能对他失效。
 *
 * 来源：旧 `GET/POST /api/console/ext/chat`。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import {
	clampBroadcastScope,
	BROADCAST_SCOPE_LABELS,
	type BroadcastScope
} from "$lib/permissions.js";
import { broadcastToClassrooms } from "$lib/server/broadcast.js";
import { listChat, addChat, canTalkInRoom } from "$lib/server/console-ext.js";
import { guardControl, readControlBody } from "$lib/server/guard-control.js";

/** @全体 / @all 口令。见文件头两个坑。 */
const AT_ALL = /(?<![A-Za-z0-9._%+-])(?:@全体|@all\b)/i;

export function GET(event: RequestEvent) {
	const g = guardControl(event);
	if ("error" in g) return g.error;

	const q = event.url.searchParams;
	return json(
		listChat(q.get("room") || "techrep-global", Number(q.get("limit") ?? 100) || 100)
	);
}

export async function POST(event: RequestEvent) {
	const g = guardControl(event, "chatClass");
	if ("error" in g) return g.error;
	const u = g.user;
	const actor = u.displayName || u.username;

	const body = await readControlBody(event);
	if (!String(body.text ?? "").trim()) return json({ error: "消息不能为空" }, { status: 400 });
	const text = String(body.text);
	const room = String(body.room || "techrep-global");

	// 一对一房间（`dm:<idA>:<idB>`）的发言权：必须是参与者，且**互为好友**。
	// 少了这道校验，任何人猜到 id 就能插进别人的私聊。
	if (!canTalkInRoom(u.id, room)) {
		return json({ error: "无权在该会话发言（需为该会话参与者且互为好友）" }, { status: 403 });
	}

	const item = addChat({ room, sender: body.from ? String(body.from) : actor, body: text });

	const wantBroadcast = body.broadcast === true || body.level === "urgent" || AT_ALL.test(text);
	let broadcast: Awaited<ReturnType<typeof broadcastToClassrooms>> | null = null;
	if (wantBroadcast) {
		// 去掉口令本身再广播（屏幕上不必显示「@全体」）。
		const clean = text.replace(/(?<![A-Za-z0-9._%+-])(?:@全体|@all\b)/gi, "").trim();

		const roomScope: BroadcastScope =
			room === "techrep-global"
				? "school"
				: room.startsWith("grade:") || room.startsWith("grade-")
					? "grade"
					: "class";
		const eff = clampBroadcastScope(u.role, roomScope);
		if (eff) {
			// class 档：优先用发起人绑定的班级；没绑定则退回房间名（本班房的 room 就是班级 id）。
			// 解析不到有效班级时 broadcast 内部会拒绝下发，**不会退化成全校**。
			const effClasses = eff === "class" ? [(u.className || "").trim() || room] : [];
			broadcast = await broadcastToClassrooms(clean || text, `来自 ${item.sender || actor} · ${room}`, {
				scope:
					BROADCAST_SCOPE_LABELS[eff] +
					(eff === "class" && effClasses[0] ? `（${effClasses[0]}）` : ""),
				classes: effClasses,
				source: "chat",
				author: actor
			});
		}
	}
	return json({ ...item, broadcast }, { status: 201 });
}
