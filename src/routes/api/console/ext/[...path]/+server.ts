import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { verifyToken, type User } from "$lib/server/auth.js";
import { can, userCan, canDevice, broadcastScope, canBroadcastTo, clampBroadcastScope, scopeFromLabel, BROADCAST_SCOPE_LABELS, type BroadcastScope, // 权限矩阵（等级轴 / 设备轴 / 分级轴 / 广播范围轴 + 当前账号快照）
	// 全部由 permissions.ts 的 permissionMatrix() 计算，本路由只做透传 ——
	// 因此不再逐个导入各轴的中文标签常量（它们只在 permissionMatrix 内部使用）。
	permissionMatrix, type Action, type DeviceTier } from "$lib/permissions.js";
import { broadcastToClassrooms } from "$lib/server/broadcast.js";
import {
	listNotices,
	addNotice,
	clearNotices,
	listChat,
	addChat,
	listAudit,
	addAudit,
	verifyAudit,
	pruneAudit,
	auditPolicy,
	consoleSummary,
	searchUsers,
	getUserBrief,
	listFriends,
	requestFriend,
	respondFriend,
	removeFriend,
	canTalkInRoom,
	// 面板持久化配置（控制 / 媒体 / 实验特性）—— 服务端存储，全校一致
	getConsoleSettings,
	saveConsoleSettings,
	CONSOLE_SETTINGS_KEYS as SETTINGS_KEYS,
	// ── 设备会话回执（远控/媒体直连）────────────────────────────────────────
	// ⚠️ 这一组曾**整体漏导入**，导致本路由一被调用就抛
	//    `ReferenceError: getDeviceSession is not defined` → HTTP 500。
	// 后果是远控链路在 API 层就断了：教室端代理 POST 回报 VNC 会话时先撞
	// `verifyDeviceReportSecret` 未定义（500），面板 GET 轮询时撞
	// `getDeviceSession` 未定义（500）—— 面板永远"等待设备回报会话地址"，
	// 而设备其实早就报过（或压根没敢报）。表现为「远控没反应」，根因却是
	// 一行 import 缺失，排查时极容易误判成网络/代理问题。
	// 教训：本文件是「多端点大杂烩」，新增端点务必核对 import —— TS 不会
	// 把未定义标识符当编译错误（会被当成全局变量放过）。
	getDeviceSession,
	clearDeviceSession,
	putDeviceSession,
	listDeviceSessions,
	verifyDeviceReportSecret
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
 *   GET    /api/console/ext/audit/verify       审计链自检（哈希链完整性 + 保留策略）
 *   POST   /api/console/ext/audit              记一条操作日志
 *   POST   /api/console/ext/audit/prune        按保留期裁剪审计（需 device.manage；裁剪本身也留痕）
 *   GET    /api/console/ext/summary            面板汇总计数
 *   GET|DELETE /api/console/ext/vnc-session    设备会话回执（面板轮询取教室端 VNC 地址）
 *   POST       /api/console/ext/vnc-session    教室端代理回报 VNC 会话（**设备密钥鉴权，非用户会话**）
 *   GET        /api/console/ext/media-session  媒体直连会话（快照/录像下载用）
 *   POST       /api/console/ext/media-session  代理回报媒体直连地址（同设备密钥鉴权）
 *   GET        /api/console/ext/sessions       全部未过期会话（诊断用；没有它就只能靠猜）
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

/**
 * 会话用户的可用形状：`User.id` 在类型上是**可选**的（兼容早期 JSON 存储），
 * 但走 `sessions JOIN users` 取出的会话用户必有 id，且本路由的协作数据
 * （好友关系、会话发言权、操作审计）全以 id 为键。
 * 在这里一次性收窄，好过每个调用点写 `u.id!` —— 也避免把 undefined
 * 静默传进按 id 查询的函数里，那种错在运行时只表现为「查不到」。
 */
type ConsoleUser = User & { id: number };

function guard(event: RequestEvent, need: Action | DeviceTier | "broadcast" = "viewConsole") {
	const u = verifyToken(event.cookies.get("admin_token"));
	if (!u) return { error: json({ error: "请先登录" }, { status: 401 }) } as const;
	// 缺 id 时后续所有以 id 为键的操作都会静默失效，不如在这里明确拒绝。
	if (typeof u.id !== "number") {
		return { error: json({ error: "会话无效，请重新登录" }, { status: 401 }) } as const;
	}
	// 等级轴：必须能进集控面板。
	if (!userCan(u, "viewConsole")) {
		return { error: json({ error: "无权限" }, { status: 403 }) } as const;
	}
	// 第二道门按 need 的归属走对应轴：设备档位查 canDevice，内容动作查 can。
	// broadcast = 复合位：内容轴 sendBroadcast（称号）或设备轴 control 档任一即可。
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
	const u = g.user;

	const path = (event.params.path ?? "").replace(/^\/+|\/+$/g, "");
	// 注意：这个 `q` 是查询串容器。下面 friends 分支里曾用 `const q = q.get("q")`
	// 遮蔽它，导致 TDZ 报错（Block-scoped variable 'q' used before its declaration），
	// 于是改成 kw —— 局部变量名不要与它同名。
	const q = event.url.searchParams;

	switch (path) {
		case "notices":
			// class 过滤：历史通知「分班级」查看（不传 = 全部）
			return json(listNotices(Number(q.get("limit") ?? 50) || 50, q.get("class") || undefined));
		case "chat":
			return json(listChat(q.get("room") || "techrep-global", Number(q.get("limit") ?? 100) || 100));
		case "audit":
			return json(listAudit(Number(q.get("limit") ?? 100) || 100, q.get("action") || undefined));
		case "audit/verify":
			// 审计链自检：走一遍哈希链，回报「从第几行起可校验 / 第一处断在哪 / 为什么」。
			// 不给「可信/不可信」的二值结论 —— 历史裁剪与旧库迁移都会合法地让链不完整，
			// 二值化会把「正常裁剪」和「有人改库」混为一谈。
			return json({ verify: verifyAudit(), policy: auditPolicy() });
		case "summary":
			return json(consoleSummary());
		case "permissions":
			// 「权限与分级」页的唯一数据源：等级轴 + 设备轴 + 管理分级轴 + 广播范围轴，
			// 以及**当前账号**的已解算快照（me）。服务端算、前端只渲染 ——
			// 前端自行推导权限是最容易出现"界面显示能点、服务端 403"的地方。
			// 传完整用户对象（含 user_titles 显式称号），me 快照与 userCan() 门控同源。
			return json(permissionMatrix(u));
		case "friends": {
			// ?q= 有值时走「找人」，否则列我的好友关系（含待处理请求）。
			const kw = q.get("q");
			if (kw !== null && kw.trim() !== "") {
				return json({ results: searchUsers(u.id, kw) });
			}
			const list = listFriends(u.id);
			return json({
				friends: list.filter((f) => f.status === "accepted"),
				incoming: list.filter((f) => f.status === "pending" && !f.outgoing),
				outgoing: list.filter((f) => f.status === "pending" && f.outgoing)
			});
		}
		case "vnc-session": {
			// 面板轮询：按 uid 取教室端回报的 VNC 会话。
			const uid = String(event.url.searchParams.get("uid") ?? "").trim();
			if (!uid) return json({ session: null, reason: "missing_uid" });
			const s = getDeviceSession("vnc", uid);
			// 明确区分「没人报过」与「报过但已过期」—— 前者要查代理，后者只要重发一次指令。
			return json({ session: s, reason: s ? "ok" : "no_session_reported" });
		}
		case "media-session": {
			const uid = String(event.url.searchParams.get("uid") ?? "").trim();
			if (!uid) return json({ session: null, reason: "missing_uid" });
			const s = getDeviceSession("media", uid);
			return json({ session: s, reason: s ? "ok" : "no_session_reported" });
		}
		case "sessions":
			// 诊断页用：一眼看到"代理到底有没有报过"，而不是只有 session:null 一个空字。
			return json({ sessions: listDeviceSessions() });
		case "settings":
			// 面板配置读取：任何能进面板的人都能读（只读不敏感，且前端要用它渲染当前策略）。
			return json({ settings: getConsoleSettings() });
		default:
			return json({ error: "unknown path" }, { status: 404 });
	}
}

export async function POST(event: RequestEvent) {
	const path = (event.params.path ?? "").replace(/^\/+|\/+$/g, "");
	const body = await readBody(event);

	// ── 设备回报分支（先于用户鉴权）────────────────────────────────────────
	// 教室端的本地代理是**无用户会话**的常驻进程，走不了 viewConsole。
	// 它需要登记「VNC 起好了，地址是 ip:port，令牌是 xxx」——这是面板能连上教室端的
	// **唯一来源**。旧实现把这条汇报直接丢弃（POST 只回 ok、GET 恒 null），
	// 造成"面板一直等待设备回报会话地址…"这个永远等不到的状态。
	//
	// 鉴权用部署级共享密钥（`CONSOLE_DEVICE_REPORT_SECRET`），且**未配置即拒绝**：
	// 这个入口会把 ip/port 写进面板要嵌的 iframe，一旦可被任意伪造，
	// 就等于"任何能访问面板的人都能把 iframe 指向自己的机器"。
	if (path === "vnc-session" || path === "media-session") {
		const secret = event.request.headers.get("x-stelarith-device-secret");
		// 带了这个头 = 调用方**自称是设备代理**（只有 Rust 代理会发，面板从不发）。
		// 此时密钥不对必须明确 403，不能落到用户鉴权分支去回「请先登录」——
		// 那会把「设备密钥配错了」伪装成「登录过期」，而这两件事的排查方向完全相反
		// （一个去查 CONSOLE_DEVICE_REPORT_SECRET / 代理环境变量，一个去重新登录）。
		// 缺失该头才落下去，保留面板自身 POST 这个路径的历史行为。
		if (secret && !verifyDeviceReportSecret(secret)) {
			return json(
				{
					error:
						"设备密钥无效：x-stelarith-device-secret 与服务端 CONSOLE_DEVICE_REPORT_SECRET 不一致（或服务端未配置，此时一律拒绝）"
				},
				{ status: 403 }
			);
		}
		if (verifyDeviceReportSecret(secret)) {
			const proto = path === "vnc-session" ? "vnc" : "media";
			const uid = String(body.uid ?? "").trim();
			if (!uid) return json({ error: "uid 不能为空" }, { status: 400 });

			// 代理上报 stopped/closed 时注销会话，别留死地址给面板。
			const stopped = body.state === "stopped" || body.state === "closed" || body.port === 0;
			if (stopped) {
				const removed = clearDeviceSession(proto, uid);
				addAudit({
					actor: `device:${uid}`,
					role: "device",
					action: `${proto}.session.stop`,
					target: uid,
					detail: removed ? "会话已注销" : "无在册会话"
				});
				return json({ ok: true, session: null, state: "cleared" });
			}

			const ip = String(body.ip ?? "").trim();
			const port = Number(body.port ?? 0);
			if (!ip || !Number.isFinite(port) || port <= 0 || port > 65535) {
				return json({ error: "ip/port 非法" }, { status: 400 });
			}
			const token = String(body.token ?? "").trim();
			const requireToken = getConsoleSettings().vnc_require_token !== false;
			if (requireToken && !token) {
				// 面板配置要求令牌时，无令牌会话视为不可用 —— 直接拒收，
				// 好过登记下来让面板连一个裸端口。
				return json({ error: "配置要求会话令牌，但上报未带 token" }, { status: 400 });
			}
			const s = putDeviceSession({
				uid,
				proto,
				ip,
				port,
				token,
				extra: typeof body.extra === "object" && body.extra ? (body.extra as Record<string, unknown>) : undefined
			});
			addAudit({
				actor: `device:${uid}`,
				role: "device",
				action: `${proto}.session.report`,
				target: uid,
				detail: `${ip}:${port}${token ? "（含令牌）" : "（无令牌）"}`
			});
			return json({ ok: true, session: s });
		}
		// 密钥不对/未配置 → 落到下面的用户鉴权分支：
		// 面板自己也可能带用户会话 POST 这个路径（历史行为），不能一律 403 打死。
	}

	// 写操作权限：按语义分档（越敏感越收紧）
	//   · notices（向大屏广播）→ 内容轴 broadcast（sendBroadcast 称号）**或** 设备轴 control 档：
	//     ⚠️ 设备三关铁律（#249）收回 teacher 的 control 后，老师仍须能发本班通知
	//     （方案表：teacher = 给本班发消息/广播，广播是内容能力，与设备轴解耦）。
	//   · chat（班级/年级群发言）→ chatClass/chatGrade：内容轴 L2，注册电教委员即可
	//   · 其余（audit 等）→ submitIssue：内容轴 L2
	const isBroadcastable = (u: ConsoleUser) => userCan(u, "sendBroadcast") || canDevice(u.role, "control");
	const need: Action | DeviceTier | "broadcast" =
		path === "notices" ? "broadcast"
		: path === "audit/prune" ? "manage"
		// settings 决定教室端行为（P2P/压缩/录像保留），属部署级配置 → 设备管理档。
		: path === "settings" ? "manage"
		: path === "chat" || path === "friends" ? "chatClass"
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
			const wantScope = scopeFromLabel(body.scope);

			// ── 分权限：能发 ≠ 能发多远 ──────────────────────────────────────
			// 设备轴 control 只说明「能下发」，范围由内容等级决定（见 permissions.ts）。
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
				? body.classes.map((c: unknown) => String(c).trim()).filter(Boolean).slice(0, 40)
				: [];

			// L2 只能发本班：未指定则**强制**为本人绑定班级，指定了非本班则拒绝。
			// 没有班级绑定时无从判定「本班」，直接拒绝并提示 —— 宁可让他先绑定，
			// 也不能因为「不知道他哪个班」就放行成全校广播。
			if (broadcastScope(u.role) === "class") {
				const myClass = (u.className || "").trim();
				if (!myClass) {
					return json({ error: "请先在个人资料中绑定班级，之后才可向本班广播" }, { status: 403 });
				}
				const outside = classes.filter((c) => c !== myClass);
				if (outside.length > 0) {
					return json({ error: `只能向本班（${myClass}）广播，不能指定：${outside.join("、")}` }, { status: 403 });
				}
				if (classes.length === 0) classes = [myClass];
			}

			// 显示时长（秒）：可选字段。非法值/越界一律当「未指定」—— 绝不因为一个坏字段
			// 把整条广播拒掉（广播是时效性操作，宁可按时长自适应也不能发不出去）。
			const durRaw = Number(body.duration_seconds);
			const seconds = Number.isFinite(durRaw) && durRaw > 0 ? Math.min(durRaw, 3600) : undefined;

			// 真推送到教室端（这是「自动推送」的核心：留痕不等于送达）。
			// ⚠️ 留痕由 broadcastToClassrooms 内部**唯一收口**，本函数不再自己 addNotice ——
			//    曾经这里又写了一次，导致每条通知在历史里出现两遍（重复 2 次的根因）。
			let broadcast: Awaited<ReturnType<typeof broadcastToClassrooms>> | null = null;
			if (body.broadcast !== false) {
				broadcast = await broadcastToClassrooms(title, content, {
					scope: body.scope || (classes.length ? classes.join("、") : "本班"),
					classes,
					source: "notice",
					author: actor,
					seconds
				});
			}

			// 纯留痕路径（显式 broadcast:false，例如补记一条历史）：此时才由路由层写。
			const item =
				broadcast?.notice ??
				addNotice({
					title,
					scope: body.scope || (classes.length ? classes.join("、") : "本班"),
					account: body.account,
					author: actor,
					sent: body.sent,
					classes,
					channel: "notice"
				});

			// 审计也只在「没走 broadcast」时补（broadcast 内部已记，避免审计双份）。
			if (!broadcast) {
				addAudit({
					actor, role: u.role, action: "notice",
					target: String(body.scope || "本班"),
					detail: `${title}（仅留痕，未推送）`.slice(0, 200)
				});
			}
			return json({ ...item, broadcast }, { status: 201 });
		}
		case "chat": {
			if (!body.text?.trim()) return json({ error: "消息不能为空" }, { status: 400 });
			const text = String(body.text);
			const room = body.room || "techrep-global";

			// 一对一房间（dm:<idA>:<idB>）的发言权：必须是这条会话的参与者，且**互为好友**。
			// 少了这道校验，任何人猜到 id 就能插进别人的私聊。
			if (!canTalkInRoom(u.id, room)) {
				return json({ error: "无权在该会话发言（需为该会话参与者且互为好友）" }, { status: 403 });
			}

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

				// 房间语义 → 范围档；再按角色上限**收敛**（而不是拒绝）：
				//   电教委员（L2）在全校群里喊 @全体 —— 语义是全校，但他只能发本班，
				//   于是收敛为「本班」。既不让他替全校发言，也不让互助功能对他失效。
				const roomScope: BroadcastScope =
					room === "techrep-global" ? "school"
					: room.startsWith("grade:") || room.startsWith("grade-") ? "grade"
					: "class";
				const eff = clampBroadcastScope(u.role, roomScope);
				if (eff) {
					// class 档：优先用发起人绑定的班级；没绑定则退回房间名（本班房的 room 就是班级 id）。
					// 解析不到有效班级时 broadcast 内部会拒绝下发，不会退化成全校。
					const effClasses =
						eff === "class" ? [(u.className || "").trim() || room] : [];
					broadcast = await broadcastToClassrooms(
						clean || text,
						`来自 ${item.sender || actor} · ${room}`,
						{
							scope: BROADCAST_SCOPE_LABELS[eff] + (eff === "class" && effClasses[0] ? `（${effClasses[0]}）` : ""),
							classes: effClasses,
							source: "chat",
							author: actor
						}
					);
				}
			}
			return json({ ...item, broadcast }, { status: 201 });
		}
		case "friends": {
			const action = String(body.action || "");
			const peerId = Number(body.peerId);
			if (!Number.isFinite(peerId) || peerId <= 0) return json({ error: "缺少 peerId" }, { status: 400 });
			if (peerId === u.id) return json({ error: "不能添加自己为好友" }, { status: 400 });

			// 对端必须真实存在：否则会攒出一堆指向假 id 的孤儿关系
			const peer = getUserBrief(peerId);
			if (!peer) return json({ error: "对方账号不存在" }, { status: 404 });

			if (action === "request") {
				const f = requestFriend(
					{ id: u.id, name: actor },
					peerId,
					peer.displayName || peer.username,
					String(body.message || "")
				);
				addAudit({ actor, role: u.role, action: "friend_request", target: peer.displayName || peer.username, detail: "发起好友申请" });
				return json({ ok: true, friend: f }, { status: 201 });
			}
			if (action === "accept" || action === "reject") {
				const ok = respondFriend(u.id, peerId, action === "accept");
				if (!ok) return json({ error: "没有待处理的申请（或你不是收件人）" }, { status: 404 });
				addAudit({ actor, role: u.role, action: "friend_" + action, target: peer.displayName || peer.username, detail: action === "accept" ? "接受好友" : "拒绝好友" });
				return json({ ok: true });
			}
			if (action === "remove") {
				const ok = removeFriend(u.id, peerId);
				addAudit({ actor, role: u.role, action: "friend_remove", target: peer.displayName || peer.username, detail: "删除好友/撤回申请" });
				return json({ ok });
			}
			return json({ error: "未知 action（request / accept / reject / remove）" }, { status: 400 });
		}
		case "audit/prune": {
			// 按保留期裁剪。**裁剪本身也要留痕** —— 否则「某天的记录去哪了」会成为
			// 又一个无法自证的疑点，而这正是审计要消灭的东西。
			const days = Number(body.days) || undefined;
			const r = pruneAudit(days);
			addAudit({
				actor,
				role: u.role,
				action: "audit.prune",
				target: String(r.retentionDays),
				detail: `裁剪审计：删除 ${r.removed} 条（保留 ${r.retentionDays} 天，截止 ${r.cutoff}），锚点=${(r.anchor || "无").slice(0, 12)}`
			});
			return json({ ok: true, ...r }, { status: 201 });
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
		case "media-session":
			// 能走到这里说明没带有效设备密钥（上面那个分支已经处理过设备回报）。
			// 面板自己不会 POST 这两个路径。返回明确原因而不是 `{ok:true}` ——
			// 「回 ok 但什么都没发生」正是这类问题最难查的形态（调用方以为成功了）。
			return json(
				{ error: "该端点由教室端代理用设备密钥上报，不接受用户会话写入", code: "device_secret_required" },
				{ status: 403 }
			);
		case "settings": {
			// PATCH 语义：只覆盖传入的键。除白名单键外一律忽略 ——
			// 这个 KV 是开放对象，若不设白名单，将来任何字段都能被写进来，
			// 等于给了一个"无害但无界"的写入面。
			const patch: Record<string, unknown> = {};
			for (const k of SETTINGS_KEYS) if (k in body) patch[k] = body[k];
			const saved = saveConsoleSettings(patch);
			addAudit({
				actor,
				role: u.role,
				action: "settings.update",
				target: "console",
				detail: `更新面板配置：${Object.keys(patch).join("、") || "（无变化）"}`.slice(0, 200)
			});
			return json({ ok: true, settings: saved });
		}
		default:
			return json({ error: "unknown path" }, { status: 404 });
	}
}

export async function DELETE(event: RequestEvent) {
	const path = (event.params.path ?? "").replace(/^\/+|\/+$/g, "");
	const g = guard(event, path === "notices" ? "manage" : "submitIssue");
	if ("error" in g) return g.error;

	if (path === "vnc-session" || path === "media-session") {
		const uid = String(event.url.searchParams.get("uid") ?? "").trim();
		if (uid) clearDeviceSession(path === "vnc-session" ? "vnc" : "media", uid);
		return json({ ok: true });
	}
	if (path === "notices") return json({ ok: true, cleared: clearNotices() });
	return json({ error: "unknown path" }, { status: 404 });
}
