import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { verifyToken, type User } from "$lib/server/auth.js";
import { can, userCan, canDevice, broadcastScope, canBroadcastTo, clampBroadcastScope, scopeFromLabel, BROADCAST_SCOPE_LABELS, type BroadcastScope, // 权限矩阵（等级轴 / 设备轴 / 分级轴 / 广播范围轴 + 当前账号快照）
	// 全部由 permissions.ts 的 permissionMatrix() 计算，本路由只做透传 ——
	// 因此不再逐个导入各轴的中文标签常量（它们只在 permissionMatrix 内部使用）。
	permissionMatrix, canDeviceAction, deviceActionsOf, canSendNoticeType, NOTICE_TYPE_LABELS, type Action, type DeviceTier, type DeviceAction, type NoticeType } from "$lib/permissions.js";
import { broadcastToClassrooms } from "$lib/server/broadcast.js";
import { classScopeOf, scopeCovers, listBindings } from "$lib/server/class-scope.js";
import { fetchClassList, fetchDeviceClassMap, classOfDevice } from "$lib/server/cims-client.js";
import {
	saveUpload,
	getFileObject,
	readFileBytes,
	pushFileToDevices,
	listDeliveries,
	updateDelivery,
	MAX_FILE_BYTES
} from "$lib/server/file-transfer.js";
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
	verifyDeviceReportSecret,
	// ── 设备截图回传（#T07.7 步骤 2）────────────────────────────────────
	// ── 截图回放 / 会话日志等历史清单的导入 ────────────────────────────────
	putDeviceCapture,
	getDeviceCapture,
	clearDeviceCapture,
	listDeviceCaptures,
	getDeviceCaptureById,
	// ── 通知回执（v2.1 类型化通知：建档 / 明细 / 设备 catch-up）────────────
	getNoticeById,
	listNoticeDeliveries,
	ensureNoticeDeliveries,
	markNoticeDelivery,
	listPendingTypedNotices,
	// ── 通知回复 / 设备执行回执（2026-09-25 补：双向传递的另一半 + 「动作做完」）──
	markNoticeReply,
	addDeviceEvent,
	listDeviceEvents,
	deviceEventStats
} from "$lib/server/console-ext.js";

/**
 * 设备密钥请求判定：带 `x-stelarith-device-secret` 头的调用方自称是教室端设备
 * （Rust 代理 / 星集控被控循环）。密钥与服务端 CONSOLE_DEVICE_REPORT_SECRET
 * 比对，未配置一律拒绝（fail-closed）。
 */
function deviceSecretOk(event: RequestEvent): boolean {
	const secret = event.request.headers.get("x-stelarith-device-secret");
	if (!secret) return false;
	return verifyDeviceReportSecret(secret);
}

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
 *   GET    /api/console/ext/events?uid=xxx     执行回执流水（被控端「动作做完」的上报）
 *   GET    /api/console/ext/notice-deliveries?notice=id
 *                                              逐台送达/回复明细（谁没回应、回了什么）
 *   POST   /api/console/ext/notice-reply       老师自由回复回传（设备密钥，与 ack 互补）
 *   POST   /api/console/ext/events             被控端执行回执上报（设备密钥）
 *   GET|DELETE /api/console/ext/vnc-session    设备会话回执（面板轮询取教室端 VNC 地址）
 *   POST       /api/console/ext/vnc-session    教室端代理回报 VNC 会话（**设备密钥鉴权，非用户会话**）
 *   GET        /api/console/ext/media-session  媒体直连会话（快照/录像下载用）
 *   POST       /api/console/ext/media-session  代理回报媒体直连地址（同设备密钥鉴权）
 *   GET        /api/console/ext/captures       设备截图回传（面板轮询取教室端截屏）
 *   POST       /api/console/ext/captures       代理回报截图 PNG（设备密钥鉴权，base64）
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

/**
 * 取请求用户：优先 `Authorization: Bearer`（桌面端官方客户端 / CLI 自检），
 * 兜底 `admin_token` cookie（浏览器面板）。两路都走同一套 verifyToken 会话校验，
 * Bearer 失效同样 401 —— 不会比 cookie 路径更宽。
 *
 * 为什么加这一层（#T07.7 步骤 4）：桌面端控制侧「远程截图 → 拉图」要轮询
 * GET /captures，但桌面端没有 cookie 机制（token 存在 shared_preferences、
 * 请求一律带 Bearer 头）。不加的话桌面端拿不到截图回传，截图链路在桌面端断掉。
 */
function requestUser(event: RequestEvent): User | null {
	const bearer = event.request.headers.get("authorization") ?? "";
	if (/^Bearer\s+/i.test(bearer)) {
		const u = verifyToken(bearer.replace(/^Bearer\s+/i, "").trim());
		if (u) return u;
	}
	return verifyToken(event.cookies.get("admin_token"));
}

function guard(event: RequestEvent, need: Action | DeviceTier | "broadcast" = "viewConsole") {
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
	const path0 = (event.params.path ?? "").replace(/^\/+|\/+$/g, "");

	// ── 设备密钥早分派（先于用户鉴权）──────────────────────────────────────
	// 设备（教室端代理 / 星集控被控循环）没有用户会话，走不了 viewConsole。
	// 它们只被允许做两类事：① 按 id 下载推送文件（file_push 指令的下半场）；
	// ② 拉取发给自己的类型化通知（island/popup/fullscreen 的 catch-up），
	//    以及回报阅读/回复状态（POST notice-ack，在下方的设备分支）。
	// 密钥不对必须明确 403，不能落到用户鉴权分支回「请先登录」——
	// 那会把「设备密钥配错」伪装成「登录过期」（与 POST 侧同款教训）。
	if (path0 === "files" || path0 === "notices") {
		const secret = event.request.headers.get("x-stelarith-device-secret");
		if (secret) {
			if (!deviceSecretOk(event)) {
				return json(
					{ error: "设备密钥无效：x-stelarith-device-secret 与服务端不一致（或服务端未配置）" },
					{ status: 403 }
				);
			}
			if (path0 === "files") {
				const fid = String(event.url.searchParams.get("id") ?? "").trim();
				const obj = fid ? getFileObject(fid) : null;
				if (!obj) return json({ error: "文件不存在或已清理", code: "not_found" }, { status: 404 });
				const bytes = readFileBytes(obj);
				if (!bytes) return json({ error: "文件内容已清理", code: "gone" }, { status: 410 });
				// 中文文件名：filename* 按 RFC 5987 编码；filename 兜底 ASCII。
				const asciiName = obj.name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
				return new Response(new Uint8Array(bytes), {
					status: 200,
					headers: {
						"content-type": "application/octet-stream",
						"content-length": String(bytes.length),
						"content-disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(obj.name)}`
					}
				});
			}
			// 被控端 catch-up：拉这台设备还没看过的类型化通知（重启后补齐弹窗）。
			const pendUid = String(event.url.searchParams.get("pending_for") ?? "").trim();
			if (!pendUid) return json({ error: "缺少 pending_for（设备 uid）" }, { status: 400 });
			return json({ notices: listPendingTypedNotices(pendUid) });
		}
		// 无设备密钥 → 落到下面的用户会话分支（面板拉历史 / 查询进度）。
	}

	const g = guard(event);
	if ("error" in g) return g.error;
	const u = g.user;

	const path = (event.params.path ?? "").replace(/^\/+|\/+$/g, "");
	// 注意：这个 `q` 是查询串容器。下面 friends 分支里曾用 `const q = q.get("q")`
	// 遮蔽它，导致 TDZ 报错（Block-scoped variable 'q' used before its declaration），
	// 于是改成 kw —— 局部变量名不要与它同名。
	const q = event.url.searchParams;
	const scope = classScopeOf(u.role, u.id);

	switch (path) {
		case "notices":
			// 历史通知：「班级」过滤分班查看（不传 = 全部）；「since」增量拉取
			// （被控端 catch-up 复用同一端点拉补课，面板轮询只看新的）。
			return json(
				listNotices(
					Number(q.get("limit") ?? 50) || 50,
					q.get("class") || undefined,
					q.get("since") || undefined
				)
			);
		case "notice-deliveries": {
			// 类型化通知的逐台回执（面板「谁看了、谁没看」明细；viewConsole 即可，
			// 与看历史同一权限档 —— 回执含设备 uid 属内部信息，不对外）。
			// 行里带 reply 字段：老师在弹窗上打的那句话原样出网，操控端才叫「收到回应」。
			const nid = Number(q.get("notice") ?? 0);
			if (!nid) return json({ error: "缺少 notice 参数" }, { status: 400 });
			const n = getNoticeById(nid);
			if (!n) return json({ error: "通知不存在" }, { status: 404 });
			return json({ notice: n, deliveries: listNoticeDeliveries(nid) });
		}
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
		case "events": {
			// 执行回执流水（面板「执行回执」页）。
			// ?uid= 省略 = 全校总览（限 300 条，够看最近几天的动作）。
			// 权限沿用 viewConsole：回执只含"设备把事情做成什么样"，不含教师身份等敏感信息。
			const uidQ = (q.get("uid") ?? "").trim();
			const hours = Number(q.get("hours"));
			const stats = uidQ
				? deviceEventStats(uidQ, Number.isFinite(hours) && hours > 0 ? hours : 24)
				: null;
			return json({ events: listDeviceEvents(uidQ || undefined, Number(q.get("limit") ?? 100) || 100), stats });
		}
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
			// ⚠️ 双 key（#T07.7 步骤 5 脱节修复）：面板下发指令用的是 CIMS 的
			// `client_id`（lab-pc-001），而教室端代理回报时用的是自己的
			// `device_uid`（主机名 n7-20091211）——两者是**不同的串**。
			// 只按 client_id 查会永远 `no_session_reported`，即使代理早就报过。
			// 与 captures 的 waitForCapture 双 key 方案对齐：先按 uid（client_id）
			// 查，miss 再按 host（= agent 的 UID）查。查询 key 本身已小写归一化
			// （console-ext.ts sKey toLowerCase），host 传大写 N7-20091211 也能命中。
			const uid = String(event.url.searchParams.get("uid") ?? "").trim();
			const host = String(event.url.searchParams.get("host") ?? "").trim();
			if (!uid && !host) return json({ session: null, reason: "missing_uid" });
			const s = getDeviceSession("vnc", uid) || (host ? getDeviceSession("vnc", host) : null);
			// 明确区分「没人报过」与「报过但已过期」—— 前者要查代理，后者只要重发一次指令。
			return json({ session: s, reason: s ? "ok" : "no_session_reported" });
		}
		case "media-session": {
			const uid = String(event.url.searchParams.get("uid") ?? "").trim();
			const host = String(event.url.searchParams.get("host") ?? "").trim();
			if (!uid && !host) return json({ session: null, reason: "missing_uid" });
			const s = getDeviceSession("media", uid) || (host ? getDeviceSession("media", host) : null);
			return json({ session: s, reason: s ? "ok" : "no_session_reported" });
		}
		case "captures": {
			// 设备截图回传：面板点「截图」下发指令后按 uid 轮询这里，拿到教室端回报的 PNG。
			// ⚠️ 双 key（#T09 老师页修复，与 vnc/media-session 同款）：面板/老师页下发指令
			// 用的是 CIMS 的 `client_id`（lab-pc-001），而教室端 agent 上报用的是自己的
			// `device_uid`（主机名 n7-20091211）——只按 client_id 查会永远
			// `no_capture_reported`，即使代理早就报过（截图的 uid 归一化在
			// console-ext.ts sKey 层完成，host 传大写 N7-20091211 也能命中）。
			// 修复前调用方只能分两次单 key 请求（面板 waitForCapture 即如此）；
			// 本修复让一次请求带 uid+host 也能命中。
			const uid = String(event.url.searchParams.get("uid") ?? "").trim();
			const host = String(event.url.searchParams.get("host") ?? "").trim();
			if (!uid && !host) return json({ capture: null, reason: "missing_uid" });

			// ── v2：监控回放（历史时间线 + 按帧取图）─────────────────────────
			// 需要 watch 或 playback 动作；目标设备的班必须在调用者班级范围内
			//（设备班解析不到 = 确定不了归属 → 不给，宁严勿泄）。
			const histUid = uid || host;
			if (q.get("history") === "1" || q.get("frame")) {
				if (!canDeviceAction(u.role, "watch") && !canDeviceAction(u.role, "playback")) {
					return json({ error: "无权限（需要监控/回放能力）" }, { status: 403 });
				}
				if (scope !== "*") {
					const cid = await classOfDevice(histUid);
					if (!cid || !scopeCovers(scope, cid)) {
						return json({ error: "目标设备不在你的班级范围内" }, { status: 403 });
					}
				}
				const frameId = Number(q.get("frame") ?? 0);
				if (frameId > 0) {
					const f = getDeviceCaptureById(frameId);
					if (!f) return json({ capture: null, reason: "frame_gone" });
					return json({
						capture: { at: f.meta.at, bytes: f.meta.bytes, image_base64: f.png.toString("base64") },
						reason: "ok"
					});
				}
				const limit = Number(q.get("limit") ?? 60) || 60;
				return json({ history: listDeviceCaptures(histUid, limit), reason: "ok" });
			}

			// 实时最新一张：同样按班级范围收敛（班主任/站长看本班/全校）。
			if (canDeviceAction(u.role, "watch") && scope !== "*") {
				const cid = await classOfDevice(histUid);
				if (cid && !scopeCovers(scope, cid)) {
					return json({ capture: null, reason: "out_of_scope" });
				}
			}
			const c = getDeviceCapture(uid) || (host ? getDeviceCapture(host) : null);
			if (!c) return json({ capture: null, reason: "no_capture_reported" });
			return json({
				capture: {
					at: c.meta.at,
					bytes: c.meta.bytes,
					// 面板要展示图片，一次请求带全字节最省事（图 ≤ 数百 KB，base64 内嵌无压力）；
					// 不另开图片二进制端点，少一个可被滥用的静态出口。
					image_base64: c.png.toString("base64")
				},
				reason: "ok"
			});
		}
		case "sessions":
			// 诊断页用：一眼看到"代理到底有没有报过"，而不是只有 session:null 一个空字。
			return json({ sessions: listDeviceSessions() });
		case "file-deliveries": {
			// 传文件回执（发送方视角）：某次推送后，每台设备收到没有。
			const fid = String(q.get("file") ?? "").trim();
			if (!fid) return json({ error: "缺少 file 参数" }, { status: 400 });
			const obj = getFileObject(fid);
			if (!obj) return json({ error: "文件不存在" }, { status: 404 });
			// 非管理员只能看「推给自己范围内班级」的回执 —— 文件上传者本身可见自己的记录。
			if (scope !== "*" && obj.uploader !== (u.displayName || u.username) && u.role !== "owner" && u.role !== "admin") {
				return json({ error: "无权限查看该文件的回执" }, { status: 403 });
			}
			return json({ file: { id: obj.id, name: obj.name, kind: obj.kind }, deliveries: listDeliveries(fid) });
		}
		case "my-classes":
			// 我的班级绑定（老师/班主任/电教委员的面板按它渲染可选目标）。
			return json({ classes: listBindings(u.id) });
		case "settings":
			// 面板配置读取：任何能进面板的人都能读（只读不敏感，且前端要用它渲染当前策略）。
			return json({ settings: getConsoleSettings() });
		default:
			return json({ error: "unknown path" }, { status: 404 });
	}
}

export async function POST(event: RequestEvent) {
	const path = (event.params.path ?? "").replace(/^\/+|\/+$/g, "");

	// ── 文件上传（multipart，先于 readBody —— JSON 解析吃不了 multipart）────
	// 发送方（老师/班主任/电教委员/站长）带用户会话上传文件本体；
	// 之后调 file-push 把它推给目标班级/设备。这里只校验「能力」，
	// 「班级范围」在 file-push 解析出目标设备后逐台判定。
	if (path === "files" && !deviceSecretOk(event)) {
		const g = guard(event, "viewConsole");
		if ("error" in g) return g.error;
		const up = g.user;
		if (!canDeviceAction(up.role, "file")) {
			return json({ error: "当前角色没有传文件能力" }, { status: 403 });
		}
		try {
			const form = await event.request.formData();
			const f = form.get("file");
			if (!(f instanceof File)) return json({ error: "缺少 file 字段（multipart）" }, { status: 400 });
			if (f.size > MAX_FILE_BYTES) {
				return json(
					{ error: `文件超过大小上限（${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB）` },
					{ status: 413 }
				);
			}
			const kind = String(form.get("kind") ?? "file") === "voice" ? "voice" : "file";
			const buf = Buffer.from(await f.arrayBuffer());
			const obj = saveUpload(f.name || "未命名文件", buf, kind, up.displayName || up.username);
			return json({ ok: true, file: obj }, { status: 201 });
		} catch (e) {
			return json({ error: String((e as Error)?.message ?? e) }, { status: 400 });
		}
	}

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
	if (path === "vnc-session" || path === "media-session" || path === "captures" || path === "file-ack" || path === "notice-ack" || path === "notice-reply" || path === "events") {
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
			if (path === "captures") {
				// 截图回传：body {uid, image_base64}。PNG 以 base64 内嵌（与 GET 取图对称）。
				const uid = String(body.uid ?? "").trim();
				if (!uid) return json({ error: "uid 不能为空" }, { status: 400 });
				const b64 = String(body.image_base64 ?? "").trim();
				if (!b64) return json({ error: "缺少 image_base64" }, { status: 400 });
				let raw: Buffer;
				try {
					raw = Buffer.from(b64, "base64");
					// 严格校验：解码再编码必须还原原串（防「垃圾字节碰巧可解码」被当成图收下）。
					if (raw.toString("base64").replace(/=+$/g, "") !== b64.replace(/=+$/g, "")) {
						throw new Error("bad base64");
					}
				} catch {
					return json({ error: "image_base64 不是合法 base64" }, { status: 400 });
				}
				// PNG 魔数校验：必须是真实 PNG（0x89 'P' 'N' 'G'），防任意垃圾字节占位。
				if (raw.length < 64 || raw[0] !== 0x89 || raw[1] !== 0x50 || raw[2] !== 0x4e || raw[3] !== 0x47) {
					return json({ error: "回传内容不是有效 PNG（<64B 或魔数不符）" }, { status: 400 });
				}
				const meta = putDeviceCapture(uid, raw);
				addAudit({
					actor: `device:${uid}`,
					role: "device",
					action: "capture.report",
					target: uid,
					detail: `${raw.length} bytes → ${meta.path.split(/[\\/]/).pop()}`
				});
				return json({ ok: true, at: meta.at, bytes: raw.length });
			}
			if (path === "file-ack") {
				// 设备侧回报 file_push 结果：下载/播放完成（acked）或失败（failed）。
				// 「文件传输后没有消息提示」的发送方半边靠它点亮 —— 老师能在
				// 传文件页看到每台设备的真实状态，而不是发送成功 = 万事大吉。
				const fid = String(body.file_id ?? "").trim();
				const duid = String(body.uid ?? "").trim();
				if (!fid || !duid) return json({ error: "file_id/uid 不能为空" }, { status: 400 });
				const state = body.state === "acked" ? "acked" : body.state === "failed" ? "failed" : "pending";
				const okUp = updateDelivery(fid, duid, state, String(body.detail ?? ""));
				addAudit({
					actor: `device:${duid}`,
					role: "device",
					action: "file.ack",
					target: fid,
					detail: `${state}${body.detail ? "：" + String(body.detail).slice(0, 120) : ""}`
				});
				return json({ ok: okUp, state });
			}
			if (path === "notice-ack") {
				// 类型化通知的设备回执：收到（received）→ 已读（read）/ 已回复（replied，
				// action_result 为预设短语原文）/ 驳回（rejected——用户点了取消/不在场）/
				// 跳过（dismissed——岛通知轮播结束不打扰）。
				// uid 由设备自称（密钥为部署级共享），防伪面：回执只更新发给「这个 uid」且
				// 未终态的行，虚报 uid 顶多把同名行提前标已读，拿不到任何内容。
				const nid = Number(body.notice_id ?? 0);
				const duid = String(body.uid ?? "").trim();
				if (!nid || !duid) return json({ error: "notice_id/uid 不能为空" }, { status: 400 });
				const st = ["read", "replied", "rejected", "dismissed", "received"].includes(String(body.state))
					? String(body.state)
					: "read";
				const okSt = markNoticeDelivery(nid, duid, st, st === "replied" ? String(body.action_result ?? "") : "");
				addAudit({
					actor: `device:${duid}`,
					role: "device",
					action: "notice.ack",
					target: String(nid),
					detail: `${st}${st === "replied" ? "：" + String(body.action_result ?? "").slice(0, 120) : ""}`
				});
				return json({ ok: okSt, state: st });
			}
			if (path === "notice-reply") {
				// 老师点了预设之外的「自由回复」，或直接在弹窗里打了字 —— 回传给操控端。
				//
				// 与 notice-ack 的区别要说清：ack 只说「收到了 / 已读 / 用了哪个预设」，
				// 是**状态**；reply 说的是「她到底回了什么话」，是**内容**。只做 ack 的话，
				// 操控端永远看不到老师在弹窗上写的那句话，老师会认定「回复功能坏了」。
				//
				// uid 由设备自称（密钥是部署级共享的），所以这里再收敛一层：
				// 只更新发给**这台设备**的行，虚报 uid 也拿不到别台机器的回复内容。
				const nid = Number(body.notice_id ?? 0);
				const duid = String(body.uid ?? "").trim();
				const text = String(body.text ?? body.body ?? "").trim();
				if (!nid || !duid) return json({ error: "notice_id/uid 不能为空" }, { status: 400 });
				if (!text) return json({ error: "回复内容不能为空" }, { status: 400 });
				const okRep = markNoticeReply(nid, duid, text);
				if (!okRep) {
					// 命中不了不是错误，但要给原因 —— 「回 ok 但什么都没发生」
					// 正是这类功能最难查的形态（调用方以为成功了，日志一片绿）。
					return json(
						{ ok: false, reason: "这条通知不是发往该设备的（或已不存在），回复未记录" },
						{ status: 404 }
					);
				}
				addAudit({
					actor: `device:${duid}`,
					role: "device",
					action: "notice.reply",
					target: String(nid),
					detail: text.slice(0, 120)
				});
				return json({ ok: true, notice_id: nid, state: "replied" }, { status: 201 });
			}
			if (path === "events") {
				// 被控端「动作做完之后」的上报（执行回执）。
				//
				// ⚠️ 这里**不做按来源 IP 的限流**：站点跑在 cloudflared 隧道后时，服务端
				// 看到的源 IP 恒为 127.0.0.1（回环转发），按来源封禁会把全校设备当一个
				// 来源误封 60s。宁可放宽限流，也不能让正常设备因为被判「异常」而断联 ——
				// 这条踩过，症状是某一时刻全域掉线，极难归因到这一行。
				// 真正的闸门是部署级共享密钥 + 下面对 extra 的体积收敛。
				const duid = String(body.uid ?? "").trim();
				const ev = String(body.event ?? "").trim();
				if (!duid || !ev) return json({ error: "uid/event 不能为空" }, { status: 400 });
				const rawExtra =
					body.extra && typeof body.extra === "object" && !Array.isArray(body.extra)
						? (body.extra as Record<string, unknown>)
						: undefined;
				try {
					const rec = addDeviceEvent({
						uid: duid,
						event: ev,
						ok: body.ok !== false,
						detail: String(body.detail ?? ""),
						extra: rawExtra,
						at: String(body.at ?? "") || undefined
					});
					return json({ ok: true, id: rec.id }, { status: 201 });
				} catch (e) {
					// 事件名/uid 非法只在这里报错 —— 绝不让一条回执的坏字段影响设备本身：
					// 那个动作在机器上是**真的做了**，回执丢了只是少一行日志。
					return json({ error: String((e as Error)?.message ?? e) }, { status: 400 });
				}
			}
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

			// ── v2：班级范围的权威来源是 user_class_bindings（真实 class_id）────
			// 旧实现用 u.className 自由文本匹配，老师带两个班时根本表达不了；
			// 现在：班级档（homeroom）只能发自己绑定的班 —— 未指定则默认全部绑定班，
			// 指定了范围外的班则拒绝。没绑定 = 空范围 = 直接拒绝（必须先绑定）。
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
						{ error: `只能向已绑定的班级（${mine.map((b) => b.class_name || b.class_id).join("、")}）发通知，不能指定：${outside.join("、")}` },
						{ status: 403 }
					);
				}
				if (classes.length === 0) classes = mine.map((b) => b.class_id);
			}

			// 显示时长（秒）：可选字段。非法值/越界一律当「未指定」—— 绝不因为一个坏字段
			// 把整条广播拒掉（广播是时效性操作，宁可按时长自适应也不能发不出去）。
			const durRaw = Number(body.duration_seconds);
			const seconds = Number.isFinite(durRaw) && durRaw > 0 ? Math.min(durRaw, 3600) : undefined;

			// ── v2.1 通知类型（notice / island / popup / fullscreen）───────────
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
			// 语音播报（TTS）是**会出声**的能力：它直接打断课堂，比文字严重得多。
			// 判据不另开一套角色表，直接复用「能发弹窗确认」这一档 —— 能敲门的才配按门铃。
			// 少了这一条，任何能发岛通知的角色都能让全校喇叭开口，而这条路线上
			// 「谁发的、什么时候发的」事后很难对上。
			if (body.tts === true && !canSendNoticeType(u.role, "popup")) {
				return json(
					{ error: "语音播报需要「弹窗确认/回复」级权限，当前角色不能发送" },
					{ status: 403 }
				);
			}
			// 类型化旗标：只收白名单字段（其余忽略），避免把任意 JSON 塞进库/指令。
			const flags: Record<string, unknown> = {};
			if (typed === "popup") {
				const presets = Array.isArray(body.reply_presets)
					? body.reply_presets.map((s: unknown) => String(s).trim()).filter(Boolean).slice(0, 6)
					: [];
				if (presets.length) flags.reply_presets = presets;
				if (body.emergency_confirm === true) flags.emergency_confirm = true;
			}
			if (typed === "popup" || typed === "fullscreen") {
				const ads = Number(body.auto_dismiss_seconds);
				if (Number.isFinite(ads) && ads > 0 && ads <= 300) flags.auto_dismiss_seconds = Math.round(ads);
			}

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
					scope: body.scope || (classes.length ? classes.join("、") : "本班"),
					account: body.account,
					author: actor,
					sent: body.sent,
					classes,
					channel: "notice",
					type: typed,
					flags
				});

			// 类型化通知：给目标设备建档回执（老师把通知发出去后能看「谁看了、谁没看」）。
			// 幂等（ensureXxx），面板通过 GET notice-deliveries 轮询明细。
			const targetUids = broadcast?.uids;
			if (typed !== "notice" && targetUids && targetUids.length > 0) {
				ensureNoticeDeliveries(item.id, targetUids);
			}

			// 审计也只在「没走 broadcast」时补（broadcast 内部已记，避免审计双份）。
			if (!broadcast) {
				addAudit({
					actor, role: u.role, action: "notice",
					target: String(body.scope || "本班"),
					detail: `${title}（仅留痕，未推送）`.slice(0, 200)
				});
			}
			// uids 是内部对账用的，不随响应出网（面板要明细走 notice-deliveries 端点）。
			const { uids: _omit, ...broadcastSafe } = broadcast ?? { ok: false, delivered: 0, total: 0 };
			return json({ ...item, typed, broadcast: broadcast ? broadcastSafe : null }, { status: 201 });
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
		case "file-push": {
			// 传文件的下半场：把已上传的文件推给目标班级/设备（file_push 指令）。
			// 能力关：传文件动作（v2 矩阵：老师/班主任/电教委员/站长）。
			// 范围关：目标班级必须 ⊆ 调用者绑定班级（站长 "*" 全校）。
			if (!canDeviceAction(u.role, "file")) {
				return json({ error: "当前角色没有传文件能力" }, { status: 403 });
			}
			// 调用者的班级范围（'*'=全校 / class_id[]）：POST 分支此前没算过，
			// 直接用会在范围关处 ReferenceError（线上 500 实证）。
			const scope = classScopeOf(u.role, u.id);
			const fid = String(body.file_id ?? "").trim();
			const file = fid ? getFileObject(fid) : null;
			if (!file) return json({ error: "文件不存在（请先上传）" }, { status: 404 });

			const wantClasses: string[] = Array.isArray(body.classes)
				? body.classes.map((c: unknown) => String(c).trim()).filter(Boolean).slice(0, 20)
				: [];
			const wantUids: string[] = Array.isArray(body.uids)
				? body.uids.map((c: unknown) => String(c).trim()).filter(Boolean).slice(0, 200)
				: [];
			if (wantClasses.length === 0 && wantUids.length === 0) {
				return json({ error: "请指定目标班级或设备" }, { status: 400 });
			}

			const map = await fetchDeviceClassMap();
			if (!map) return json({ error: "CIMS 不可达，无法解析目标设备" }, { status: 502 });

			// 班级 → 设备；每个目标班先过范围关（class_id 或名称命中都算）。
			const uids = new Set<string>();
			const targets: string[] = [];
			for (const c of wantClasses) {
				const hit = map.classes.find((x) => x.class_id === c || x.name === c);
				if (!hit) return json({ error: `班级不存在或未绑定设备：${c}` }, { status: 404 });
				if (scope !== "*" && !scopeCovers(scope, hit.class_id)) {
					return json(
						{ error: `班级 ${hit.name || hit.class_id} 不在你的绑定范围内` },
						{ status: 403 }
					);
				}
				targets.push(hit.class_id);
				for (const [uidKey, cid] of map.uidToClass) {
					if (cid.toLowerCase() === hit.class_id.toLowerCase()) uids.add(uidKey);
				}
			}
			// 直接指定设备：逐台查班级、过范围关。
			for (const uid of wantUids) {
				const cid = map.uidToClass.get(uid.toLowerCase()) ?? "";
				if (scope !== "*") {
					if (!cid || !scopeCovers(scope, cid)) {
						return json(
							{ error: `设备 ${uid} 不在你的绑定范围内（或未划班）` },
							{ status: 403 }
						);
					}
				}
				uids.add(uid.toLowerCase());
				if (cid && !targets.includes(cid)) targets.push(cid);
			}
			if (uids.size === 0) return json({ error: "目标班级下没有可推送的设备" }, { status: 404 });

			const results = await pushFileToDevices(file, [...uids], (uid2) =>
				map.uidToClass.get(uid2.toLowerCase()) ?? ""
			);
			addAudit({
				actor: u.displayName || u.username,
				role: u.role,
				action: "file_push",
				target: targets.join("、") || uids.size + " 台设备",
				detail: `推送「${file.name}」（${Math.round(file.size / 1024)}KB）到 ${uids.size} 台设备`
			});
			return json({ ok: true, file: { id: file.id, name: file.name }, targets, results }, { status: 201 });
		}
		case "vnc-session":
		case "media-session":
		case "captures":
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

	if (path === "vnc-session" || path === "media-session" || path === "captures") {
		const uid = String(event.url.searchParams.get("uid") ?? "").trim();
		if (!uid) return json({ ok: false, error: "missing_uid" });
		if (path === "captures") {
			clearDeviceCapture(uid);
			return json({ ok: true });
		}
		clearDeviceSession(path === "vnc-session" ? "vnc" : "media", uid);
		return json({ ok: true });
	}
	if (path === "notices") return json({ ok: true, cleared: clearNotices() });
	return json({ error: "unknown path" }, { status: 404 });
}
