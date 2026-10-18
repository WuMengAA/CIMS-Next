/**
 * 控制轴 · 好友关系（`/api/console/control/friends`）
 *
 *   GET  — `?q=` 有值时「找人」，否则列我的好友关系（含待处理请求）
 *   POST — `{ action: request|accept|reject|remove, peerId, message? }`
 *
 * 权限：`chatClass`（与交流同档 —— 好友是私聊的前提）。
 *
 * ⚠️ **对端必须真实存在**：否则会攒出一堆指向假 id 的**孤儿关系**。
 *
 * 来源：旧 `GET/POST /api/console/ext/friends`。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import {
	searchUsers,
	getUserBrief,
	listFriends,
	requestFriend,
	respondFriend,
	removeFriend,
	addAudit
} from "$lib/server/console-ext.js";
import { guardControl, readControlBody } from "$lib/server/guard-control.js";

export async function GET(event: RequestEvent) {
	const g = await guardControl(event);
	if ("error" in g) return g.error;
	const u = g.user;

	const kw = event.url.searchParams.get("q");
	if (kw !== null && kw.trim() !== "") {
		return json({ results: await searchUsers(u.id, kw) });
	}
	const list = await listFriends(u.id);
	return json({
		friends: list.filter((f) => f.status === "accepted"),
		incoming: list.filter((f) => f.status === "pending" && !f.outgoing),
		outgoing: list.filter((f) => f.status === "pending" && f.outgoing)
	});
}

export async function POST(event: RequestEvent) {
	const g = await guardControl(event, "chatClass");
	if ("error" in g) return g.error;
	const u = g.user;
	const actor = u.displayName || u.username;

	const body = await readControlBody(event);
	const action = String(body.action || "");
	const peerId = Number(body.peerId);
	if (!Number.isFinite(peerId) || peerId <= 0) return json({ error: "缺少 peerId" }, { status: 400 });
	if (peerId === u.id) return json({ error: "不能添加自己为好友" }, { status: 400 });

	// 对端必须真实存在（否则攒出孤儿关系）。
	const peer = await getUserBrief(peerId);
	if (!peer) return json({ error: "对方账号不存在" }, { status: 404 });
	const peerName = peer.displayName || peer.username;

	if (action === "request") {
		const f = await requestFriend({ id: u.id, name: actor }, peerId, peerName, String(body.message || ""));
		await addAudit({ actor, role: u.role, action: "friend_request", target: peerName, detail: "发起好友申请" });
		return json({ ok: true, friend: f }, { status: 201 });
	}
	if (action === "accept" || action === "reject") {
		const ok = await respondFriend(u.id, peerId, action === "accept");
		if (!ok) return json({ error: "没有待处理的申请（或你不是收件人）" }, { status: 404 });
		await addAudit({
			actor,
			role: u.role,
			action: "friend_" + action,
			target: peerName,
			detail: action === "accept" ? "接受好友" : "拒绝好友"
		});
		return json({ ok: true });
	}
	if (action === "remove") {
		const ok = await removeFriend(u.id, peerId);
		await addAudit({ actor, role: u.role, action: "friend_remove", target: peerName, detail: "删除好友/撤回申请" });
		return json({ ok });
	}
	return json({ error: "未知 action（request / accept / reject / remove）" }, { status: 400 });
}
