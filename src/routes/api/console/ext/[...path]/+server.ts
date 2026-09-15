import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { can, canDevice, type Action, type DeviceTier } from "$lib/permissions.js";
import { broadcastToClassrooms } from "$lib/server/broadcast.js";
import {
	listNotices,
	addNotice,
	clearNotices,
	listChat,
	addChat,
	listAudit,
	addAudit,
	consoleSummary
} from "$lib/server/console-ext.js";

/**
 * 集控面板协作数据接口（站点侧，替代纯前端演示数据）。
 *
 * 端点（由面板 api.js 的 extHost 指向 /api/console/ext）：
 *   GET    /api/console/ext/notices            通知广播历史
 *   POST   /api/console/ext/notices            发通知：留痕 + **自动推送到教室大屏**
 *   DELETE /api/console/ext/notices            清空历史（需 device.manage）
 *   GET    /api/console/ext/chat?room=xxx      班级交流消息（按房间隔离）
 *   POST   /api/console/ext/chat               发送消息（**@全体/重要等级时自动广播到大屏**）
 *   GET    /api/console/ext/audit?action=xxx   操作日志
 *   POST   /api/console/ext/audit              记一条操作日志
 *   GET    /api/console/ext/summary            面板汇总计数
 *   GET|DELETE /api/console/ext/vnc-session    设备会话回执（无设备代理时恒为空，保持面板轮询不报错）
 *
 * 权限：所有端点需 viewConsole（等级轴 L1+）；写操作另需设备档位或内容能力 ——
 * 通知留痕/清空需 device.control，其余写操作需 submitIssue（L2 参与能力）。
 * 用 `设备档位` 还是 `内容动作` 由 need 的形式区分（字符串是否属于 DeviceTier）。
 *
 * 「不要只停留在手动输入」的实现点：
 *   ① 发通知 = 落库留痕 **+ 真的推到设备**（之前只留痕，教室端什么都收不到）
 *   ② 群里发消息带 @全体 / 等级=urgent 时，自动升级为教室大屏广播
 *   两条都不需要调用方额外做任何事 —— 面板只管发，推是服务端的事。
 */

/** 设备档位白名单，用于区分 guard 的第二个参数走哪条轴。 */
const DEVICE_TIERS: DeviceTier[] = ["watch", "control", "remote", "manage"];

function guard(event: RequestEvent, need: Action | DeviceTier = "viewConsole") {
	const u = verifyToken(event.cookies.get("admin_token"));
	if (!u) return { error: json({ error: "请先登录" }, { status: 401 }) } as const;
	// 等级轴：必须能进集控面板。
	if (!can(u.role, "viewConsole")) {
		return { error: json({ error: "无权限" }, { status: 403 }) } as const;
	}
	// 第二道门按 need 的归属走对应轴：设备档位查 canDevice，内容动作查 can。
	const ok = DEVICE_TIERS.includes(need as DeviceTier)
		? canDevice(u.role, need as DeviceTier)
		: can(u.role, need as Action);
	if (!ok) {
		return { error: json({ error: "无权限" }, { status: 403 }) } as const;
	}
	return { user: u } as const;
}

async function readBody(event: RequestEvent): Promise<any> {
	try {
		return await event.request.json();
	} catch {
		return {};
	}
}

export async function GET(event: RequestEvent) {
	const g = guard(event);
	if ("error" in g) return g.error;

	const path = (event.params.path ?? "").replace(/^\/+|\/+$/g, "");
	const q = event.url.searchParams;

	switch (path) {
		case "notices":
			return json(listNotices(Number(q.get("limit") ?? 50) || 50));
		case "chat":
			return json(listChat(q.get("room") || "techrep-global", Number(q.get("limit") ?? 100) || 100));
		case "audit":
			return json(listAudit(Number(q.get("limit") ?? 100) || 100, q.get("action") || undefined));
		case "summary":
			return json(consoleSummary());
		case "vnc-session":
			// 无设备侧代理回报时恒为空会话；面板据此走「未收到回执」分支，行为与之前一致。
			return json({ session: null });
		default:
			return json({ error: "unknown path" }, { status: 404 });
	}
}

export async function POST(event: RequestEvent) {
	const path = (event.params.path ?? "").replace(/^\/+|\/+$/g, "");
	const body = await readBody(event);

	// 写操作权限：按语义分档（越敏感越收紧）
	//   · notices（向大屏广播）→ device.control：设备级可见操作，电教委员及以上
	//   · chat（班级/年级群发言）→ chatClass/chatGrade：内容轴 L2，注册电教委员即可
	//   · 其余（audit 等）→ submitIssue：内容轴 L2
	const need: Action | DeviceTier =
		path === "notices" ? "control"
		: path === "chat" ? "chatClass"
		: "submitIssue";
	const g = guard(event, need);
	if ("error" in g) return g.error;
	const u = g.user;
	const actor = u.displayName || u.username;

	switch (path) {
		case "notices": {
			if (!body.title?.trim()) return json({ error: "标题不能为空" }, { status: 400 });
			const title = String(body.title).trim();
			const content = String(body.content || "").trim();

			// 真推送到教室端（这是「自动推送」的核心：留痕不等于送达）。
			// 面板只需 POST 一次，服务端负责把握手/留痕/审计都做完。
			// body.broadcast === false 可显式只留痕（例如补记一条历史）。
			let broadcast: Awaited<ReturnType<typeof broadcastToClassrooms>> | null = null;
			if (body.broadcast !== false) {
				broadcast = await broadcastToClassrooms(title, content, {
					scope: body.scope || "本班",
					source: "notice"
				});
			}

			const item = addNotice({
				title,
				scope: body.scope,
				account: body.account,
				author: actor,
				// sent 用真实送达数（之前直接采信调用方传的值，会把「没送到」记成「送到了」）
				sent: broadcast ? broadcast.delivered : body.sent
			});
			addAudit({
				actor, role: u.role, action: "notice",
				target: String(body.scope || "本班"),
				detail: `${title}（送达 ${broadcast ? broadcast.delivered + "/" + broadcast.total : "未推送"}）`.slice(0, 200)
			});
			return json({ ...item, broadcast }, { status: 201 });
		}
		case "chat": {
			if (!body.text?.trim()) return json({ error: "消息不能为空" }, { status: 400 });
			const text = String(body.text);
			const room = body.room || "techrep-global";
			const item = addChat({ room, sender: body.from || actor, body: text });

			// 重要消息自动升级为教室大屏广播：群里喊一句「@全体 投影坏了」，
			// 相关教室的屏幕直接弹出来 —— 不必再切到「通知广播」页重敲一遍。
			// 触发条件：正文含 @全体/@all，或 body.broadcast === true，或 level === "urgent"。
			//
			// ⚠️ 匹配式两个坑，都踩过：
			//   ① 不能用统一尾随 `\b`：「体」是 CJK，而 JS 的 `\b` 只认 ASCII 词字符
			//      边界，/@(全体|all)\b/ 对「@全体 明天上课」恒为 false —— 最常用的
			//      口令反而完全失效（实测只有 @all 分支能命中）。故 `@全体` 分支
			//      **不带** `\b`，只有需要防「@allen」这类英文误伤的 `@all` 才带。
			//   ② `@all` 还要防止误伤邮箱（a@all.com）：用后行断言要求 `@` 前面
			//      不是邮箱本地部分的字符，这样「发给 x@all.org」不会被当成喊话。
			const AT_ALL = /(?<![A-Za-z0-9._%+-])(?:@全体|@all\b)/i;
			const wantBroadcast =
				body.broadcast === true || body.level === "urgent" || AT_ALL.test(text);
			let broadcast: Awaited<ReturnType<typeof broadcastToClassrooms>> | null = null;
			if (wantBroadcast) {
				const clean = text.replace(/(?<![A-Za-z0-9._%+-])(?:@全体|@all\b)/gi, "").trim();
				broadcast = await broadcastToClassrooms(
					clean || text,
					`来自 ${item.sender || actor} · ${room}`,
					{ scope: room === "techrep-global" ? "全校电教委员" : room, source: "chat" }
				);
			}
			return json({ ...item, broadcast }, { status: 201 });
		}
		case "audit": {
			if (!body.action) return json({ error: "缺少 action" }, { status: 400 });
			const item = addAudit({
				actor: actor,
				role: u.role,
				action: body.action,
				target: body.target,
				detail: body.detail
			});
			return json(item, { status: 201 });
		}
		case "vnc-session":
			return json({ ok: true });
		default:
			return json({ error: "unknown path" }, { status: 404 });
	}
}

export async function DELETE(event: RequestEvent) {
	const path = (event.params.path ?? "").replace(/^\/+|\/+$/g, "");
	const g = guard(event, path === "notices" ? "manage" : "submitIssue");
	if ("error" in g) return g.error;

	if (path === "vnc-session") return json({ ok: true });
	if (path === "notices") return json({ ok: true, cleared: clearNotices() });
	return json({ error: "unknown path" }, { status: 404 });
}
