import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { can, type Action } from "$lib/permissions.js";
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
 *   POST   /api/console/ext/notices            记一条通知留痕
 *   DELETE /api/console/ext/notices            清空历史（需 manageDevices）
 *   GET    /api/console/ext/chat?room=xxx      班级交流消息（按房间隔离）
 *   POST   /api/console/ext/chat               发送消息
 *   GET    /api/console/ext/audit?action=xxx   操作日志
 *   POST   /api/console/ext/audit              记一条操作日志
 *   GET    /api/console/ext/summary            面板汇总计数
 *   GET|DELETE /api/console/ext/vnc-session    设备会话回执（无设备代理时恒为空，保持面板轮询不报错）
 *
 * 权限：所有端点需 viewConsole；写操作额外要求 submitIssue，通知留痕要求 controlDevice。
 */

function guard(event: RequestEvent, need: Action = "viewConsole") {
	const u = verifyToken(event.cookies.get("admin_token"));
	if (!u) return { error: json({ error: "请先登录" }, { status: 401 }) } as const;
	if (!can(u.role, "viewConsole") || !can(u.role, need)) {
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

	// 写操作权限：通知留痕需 controlDevice，其余写操作需 submitIssue。
	const need: Action = path === "notices" ? "controlDevice" : "submitIssue";
	const g = guard(event, need);
	if ("error" in g) return g.error;
	const u = g.user;
	const actor = u.displayName || u.username;

	switch (path) {
		case "notices": {
			if (!body.title?.trim()) return json({ error: "标题不能为空" }, { status: 400 });
			const item = addNotice({
				title: body.title,
				scope: body.scope,
				account: body.account,
				author: actor,
				sent: body.sent
			});
			addAudit({ actor, role: u.role, action: "notice", target: String(body.scope || "本班"), detail: String(body.title).slice(0, 200) });
			return json(item, { status: 201 });
		}
		case "chat": {
			if (!body.text?.trim()) return json({ error: "消息不能为空" }, { status: 400 });
			const item = addChat({ room: body.room, sender: body.from || actor, body: body.text });
			return json(item, { status: 201 });
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
	const g = guard(event, path === "notices" ? "manageDevices" : "submitIssue");
	if ("error" in g) return g.error;

	if (path === "vnc-session") return json({ ok: true });
	if (path === "notices") return json({ ok: true, cleared: clearNotices() });
	return json({ error: "unknown path" }, { status: 404 });
}
