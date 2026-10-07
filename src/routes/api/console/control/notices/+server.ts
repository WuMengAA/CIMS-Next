/**
 * 控制轴 · 通知广播（`/api/console/control/notices`）
 *
 *   GET    — 历史通知（「班级」过滤分班查看；`since` 增量拉取）
 *   POST   — 发通知：留痕 + **真的推送到教室大屏**
 *   DELETE — 清空历史
 *
 * 权限：GET 默认 viewConsole；POST 走**复合位 broadcast**（内容轴 `sendBroadcast` 或设备轴 control）；
 * DELETE 需设备管理档。
 *
 * 来源：旧 `GET/POST/DELETE /api/console/ext/notices` 的**用户会话分支**。
 * 与之对称的**被控轴**是 `GET /api/device/notices`（设备拉自己的 catch-up）——
 * 名字像、语义完全不同，别合并。
 *
 * ⚠️ 本文件保留了旧实现里三条踩过坑的判据（不要"顺手简化"掉）：
 *   · **留痕由 `broadcastToClassrooms` 内部唯一收口**，路由层不得再 `addNotice` 一次
 *     —— 曾经两边都写，导致每条通知在历史里出现两遍；
 *   · 旗标 `flags` **既收 `body.flags` 也收顶层字段**（面板放嵌套、早期脚本放顶层）
 *     —— 曾因只读顶层，面板发的一切旗标被静默丢弃，全屏通知因此**永不自动关闭**；
 *   · 语音播报（TTS）是"会出声"的能力，另按"能发弹窗确认"那一档收权
 *     —— 少了它，任何能发岛通知的角色都能让全校喇叭开口。
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { canDevice, broadcastScope, canBroadcastTo, scopeFromLabel, BROADCAST_SCOPE_LABELS, canSendNoticeType, NOTICE_TYPE_LABELS, type NoticeType } from "$lib/permissions.js";
import { broadcastToClassrooms } from "$lib/server/broadcast.js";
import { listBindings } from "$lib/server/class-scope.js";
import {
	listNotices,
	addNotice,
	clearNotices,
	ensureNoticeDeliveries,
	addAudit
} from "$lib/server/console-ext.js";
import { guardControl, readControlBody } from "$lib/server/guard-control.js";

export function GET(event: RequestEvent) {
	const g = guardControl(event);
	if ("error" in g) return g.error;

	const q = event.url.searchParams;
	// 历史通知：「班级」过滤分班查看（不传 = 全部）；「since」增量拉取
	//（被控端 catch-up 复用同一端点拉补课，面板轮询只看新的）。
	return json(
		listNotices(
			Number(q.get("limit") ?? 50) || 50,
			q.get("class") || undefined,
			q.get("since") || undefined
		)
	);
}

export async function POST(event: RequestEvent) {
	const g = guardControl(event, "broadcast");
	if ("error" in g) return g.error;
	const u = g.user;
	const actor = u.displayName || u.username;

	const body = await readControlBody(event);
	if (!String(body.title ?? "").trim()) return json({ error: "标题不能为空" }, { status: 400 });
	const title = String(body.title).trim();
	const content = String(body.content || "").trim();
	const wantScope = scopeFromLabel(body.scope);

	// ── 分权限：能发 ≠ 能发多远 ──────────────────────────────────────────
	// 设备轴 control 只说明「能下发」，范围由内容等级决定。
	// 电教委员（L2）最多发本班；年级需要 L3；全校需要 L4+。
	if (!canBroadcastTo(u.role, wantScope)) {
		const max = broadcastScope(u.role);
		return json(
			{
				error: max
					? `当前账号最多只能广播到「${BROADCAST_SCOPE_LABELS[max]}」，不能选择「${BROADCAST_SCOPE_LABELS[wantScope]}」`
					: "当前账号没有广播权限"
			},
			{ status: 403 }
		);
	}

	// 目标班级（多班级定向）。传了就等于「只推这些班」，不再全校下发。
	let classes: string[] = Array.isArray(body.classes)
		? (body.classes as unknown[]).map((c) => String(c).trim()).filter(Boolean).slice(0, 40)
		: [];

	// ── v2：班级范围的权威来源是 user_class_bindings（真实 class_id）──────
	// 旧实现用 u.className 自由文本匹配，老师带两个班时根本表达不了。
	// 现在：班级档只能发自己绑定的班；未指定则默认全部绑定班；指定范围外则拒绝。
	// **没绑定 = 空范围 = 直接拒绝**（必须先绑定）。
	if (broadcastScope(u.role) === "class") {
		const mine = listBindings(u.id);
		if (mine.length === 0) {
			return json({ error: "请先让管理员为你绑定班级，之后才可向本班发通知" }, { status: 403 });
		}
		const inScope = (c: string) =>
			mine.some((b) => b.class_id === c || (b.class_name && b.class_name === c));
		const outside = classes.filter((c) => !inScope(c));
		if (outside.length > 0) {
			return json(
				{
					error: `只能向已绑定的班级（${mine.map((b) => b.class_name || b.class_id).join("、")}）发通知，不能指定：${outside.join("、")}`
				},
				{ status: 403 }
			);
		}
		if (classes.length === 0) classes = mine.map((b) => b.class_id);
	}

	// 显示时长（秒）：可选。非法/越界一律当「未指定」——
	// 绝不因为一个坏字段把整条广播拒掉（广播是时效性操作）。
	const durRaw = Number(body.duration_seconds);
	const seconds = Number.isFinite(durRaw) && durRaw > 0 ? Math.min(durRaw, 3600) : undefined;

	// ── v2.1 通知类型（notice / island / popup / fullscreen）─────────────
	// 类型决定教室端的呈现（课表岛 / 弹窗 / 全屏），由角色矩阵服务端强制：
	// teacher=notice/island，homeroom 加 popup，admin/owner 全 4 种。
	const rawType = String(body.type || "notice").trim();
	const typed: NoticeType = ["notice", "island", "popup", "fullscreen"].includes(rawType)
		? (rawType as NoticeType)
		: "notice";
	if (typed !== "notice" && !canSendNoticeType(u.role, typed)) {
		return json(
			{ error: `当前角色不能发送「${NOTICE_TYPE_LABELS[typed] ?? typed}」通知` },
			{ status: 403 }
		);
	}
	// 语音播报（TTS）是**会出声**的能力：直接打断课堂，比文字严重得多。
	// 判据不另开一套角色表，复用「能发弹窗确认」这一档 —— 能敲门的才配按门铃。
	if (body.tts === true && !canSendNoticeType(u.role, "popup")) {
		return json(
			{ error: "语音播报需要「弹窗确认/回复」级权限，当前角色不能发送" },
			{ status: 403 }
		);
	}

	// 类型化旗标：只收白名单字段（其余忽略），避免把任意 JSON 塞进库/指令。
	//
	// ⚠️⚠️ 2026-10-01 修（**谎报成功**级）：面板把旗标放在 **body.flags** 对象里，
	// 而旧实现只读**顶层** body.auto_dismiss_seconds / reply_presets /
	// emergency_confirm / tts —— 于是面板发的一切旗标被**整个丢掉**：
	// 实测发 fullscreen 后响应 `flags:"{}"`，老师把「自动关屏」填成 30 秒、
	// 选「紧急·需确认已读」，界面显示成功、服务端也回 201「已下发到 N 台设备」，
	// 教室端却一条旗标都没收到 —— 全屏通知因此**永不自动关闭**。
	// （设备侧 device_agent.dart 读的是嵌套 flags，即它一直按「嵌套」约定 —— 错的是服务端。）
	// 现在两边都收：**body.flags 优先**，顶层字段保留兼容（早期直连脚本按顶层发）。
	const flagSrc: Record<string, unknown> =
		body.flags && typeof body.flags === "object" && !Array.isArray(body.flags)
			? (body.flags as Record<string, unknown>)
			: {};
	const pick = (k: string): unknown => (flagSrc[k] !== undefined ? flagSrc[k] : body[k]);

	const flags: Record<string, unknown> = {};
	if (typed === "popup") {
		const rawPresets = pick("reply_presets");
		const presets = Array.isArray(rawPresets)
			? (rawPresets as unknown[]).map((s) => String(s).trim()).filter(Boolean).slice(0, 6)
			: [];
		if (presets.length) flags.reply_presets = presets;
		// 2026-10-07 对齐 Qt 被控端：被控端（stelarith-control-qt · notifyFromParams）
		// 读 flags.confirm（需确认）与 flags.replies（快捷回复话术）；旧名 reply_presets /
		// emergency_confirm 保留给旧被控端与存档案，避免字段名不一致的"假绿"（发了界面
		// 报成功、教室端实际不显示确认按钮/快捷回复）。
		if (presets.length) flags.replies = presets;
		if (pick("emergency_confirm") === true) {
			flags.emergency_confirm = true;
			flags.confirm = true;
		}
	}
	if (typed === "popup" || typed === "fullscreen") {
		// 语音播报：会出声的能力，同样只走白名单、严格判定 true。
		// ⚠️ 2026-10-05 修：字段名对齐被控端 —— Qt 只读 flags.speech，不读 tts。
		//    旧名 tts 会让老师勾了也不出声（界面照回 201「已下发」，属假绿）。
		if (pick("tts") === true) flags.speech = true;
		// 时长由 params.seconds 承载（见下），flags 里不再放 auto_dismiss_seconds —— Qt 不读。
	}
	// 全屏严重度（决定大屏配色 + 是否要求「确认已读」）。
	// 非白名单值一律**忽略**（绝不把一个任意串塞进下发给教室端的指令里）。
	if (typed === "fullscreen") {
		const sev = String(pick("severity") ?? "").trim();
		if (["remind", "inform", "urgent"].includes(sev)) flags.severity = sev;
	}

	// 真推送到教室端（「自动推送」的核心：留痕不等于送达）。
	// ⚠️ 留痕由 broadcastToClassrooms 内部**唯一收口**，本函数不再自己 addNotice。
	let broadcast: Awaited<ReturnType<typeof broadcastToClassrooms>> | null = null;
	if (body.broadcast !== false) {
		broadcast = await broadcastToClassrooms(title, content, {
			scope: String(body.scope || (classes.length ? classes.join("、") : "本班")),
			classes,
			source: "notice",
			author: actor,
			seconds,
			type: typed,
			flags
		});
	}

	// 纯留痕路径（显式 broadcast:false，例如补记一条历史）：此时才由路由层写。
	const item =
		broadcast?.notice ??
		addNotice({
			title,
			scope: String(body.scope || (classes.length ? classes.join("、") : "本班")),
			account: body.account as string | undefined,
			author: actor,
			sent: body.sent as number | undefined,
			classes,
			channel: "notice",
			type: typed,
			flags
		});

	// 类型化通知：给目标设备建档回执（老师发出去后能看「谁看了、谁没看」）。
	// 幂等（ensureXxx），面板通过 GET notice-deliveries 轮询明细。
	const targetUids = broadcast?.uids;
	if (typed !== "notice" && targetUids && targetUids.length > 0) {
		ensureNoticeDeliveries(item.id, targetUids);
	}

	// 审计也只在「没走 broadcast」时补（broadcast 内部已记，避免审计双份）。
	if (!broadcast) {
		addAudit({
			actor,
			role: u.role,
			action: "notice",
			target: String(body.scope || "本班"),
			detail: `${title}（仅留痕，未推送）`.slice(0, 200)
		});
	}
	// uids 是内部对账用的，不随响应出网（面板要明细走 notice-deliveries 端点）。
	//
	// ⚠️ **除 uids 之外必须原样透传**（2026-10-02 A4.1 修）。
	// 我初版只挑了 {ok, delivered, total} 三个字段，把 `deduped` 与 `error` 丢了 ——
	// 而面板 broadcast/+page.svelte:125,127 与 notify/+page.svelte:97,99 正是读这两个：
	//   · deduped → 「内容重复，未重复下发」的提示
	//   · error   → 「已留痕但未下发成功」的提示
	// 丢了它们，两种情况都会静默落到 `else toast.success("已发布")` ——
	// 也就是**把"没发出去"报成"已发布"**，这正是项目里最忌讳的那类假绿。
	// 旧实现是 `const { uids: _omit, ...rest } = broadcast`，这里保持同一语义。
	const broadcastSafe = broadcast
		? (({ uids: _uidsOmitted, ...rest }) => rest)(broadcast)
		: null;
	return json({ ...item, typed, broadcast: broadcastSafe }, { status: 201 });
}

export function DELETE(event: RequestEvent) {
	const g = guardControl(event, "manage");
	if ("error" in g) return g.error;
	// 清空历史也要留痕：否则「某段时间的通知去哪了」会变成无法自证的疑点。
	addAudit({
		actor: g.user.displayName || g.user.username,
		role: g.user.role,
		action: "notice.clear",
		target: "console",
		detail: "清空通知历史"
	});
	return json({ ok: true, cleared: clearNotices() });
}
