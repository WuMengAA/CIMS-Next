import { env as privateEnv } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import {
	addNotice,
	addAudit,
	setNoticeSent,
	ensureNoticeDeliveries,
	markNoticeDelivery,
	type ConsoleNotice
} from "./console-ext.js";
import { resolveDeviceClassMap, canonicalUid as selfCanonicalUid } from "./stelarith/devices.js";

// ── 广播下发（把站内公告/消息推送到教室端大屏）────────────────────────
//
// 设计要点（为什么放在服务端而不是面板里）：
//   面板里的 sendNotice 是「人在页面上手动敲一条」——那只是通道，不是自动化。
//   真正需要的是：网站侧发生一件事（发公告、发通知、电教委员在群里喊话），
//   教室端**自动**收到，不需要任何人再手动转一遍。
//
// 链路（2026-10-04 · 乙阶段，已脱离 CIMS）：
//   网站事件 → 本模块 → 云端 8788 `POST /api/instructions {action:"notify"}`
//                    → 云端 sendInstruction（在线才发，落盘+回执配对）
//                    → 被控端 executeAction("notify") → 大屏显示 + 回执 done
//                    → 云端 recordResult → 站点回执聚合（notice_deliveries）
//
// 两条降级路径（都不能让上层调用失败）：
//   ① 云端未配置 / 不可达 → 只留痕到 console_notices，返回 delivered:0
//   ② 单台设备失败/离线 → 跳过该台，继续推其余设备（云端 409 不算送达）
//
// ── 两个曾经出过事的点，改这里前务必读 ─────────────────────────────────────
//
// ① **留痕唯一收口在本模块**（就是下面那个 addNotice）。
//    曾经 /api/console/ext/notices 的路由层在本模块之外**又** addNotice 了一次，
//    结果每条通知在历史里出现两遍（用户看到「重复了 2 次」）。现在规矩是：
//    谁调用 broadcastToClassrooms，谁就用返回的 `notice`，**不要再自己写一条**。
//    只有「不推送、纯留痕」的路径才由调用方直接调 addNotice。
//
// ② **多通道重复推送**：同一条内容可能被两条通道各自触发（例如网站发公告 +
//    面板手动发通知，或群里喊话被升级为广播后再手工重发）。设备端表现为
//    弹出两次遮罩。这里用短时窗口去重：内容 + 目标完全相同的推送，在
//    DEDUPE_WINDOW_MS 内只实际下发一次，第二次返回 `deduped: true` 且**不留痕**
//    （否则又是变相的重复）。确需强制重发时传 `force: true`。

export interface BroadcastResult {
	ok: boolean;
	delivered: number;
	total: number;
	/** 本次留痕记录（唯一样本）。被去重抑制时为 undefined —— 因为它没有产生新通知。 */
	notice?: ConsoleNotice;
	/** 收到推送的目标设备（建档回执用；类型化通知才有，普通 notice 通常不需要）。 */
	uids?: string[];
	/** true = 命中了短时去重窗口，未重复下发、未重复留痕。 */
	deduped?: boolean;
	error?: string;
}

/** 去重窗口：内容完全相同的推送在此毫秒内只下发一次。 */
const DEDUPE_WINDOW_MS = 30_000;
/** key → 上次实际下发时间戳。进程内即可：站点是单实例部署，重启丢窗口无副作用。 */
const recentBroadcasts = new Map<string, number>();

function dedupeKey(title: string, content: string, classes: string[]): string {
	// 目标集合排序后参与 key：同样的内容发给不同班级不算重复。
	return [title, content, [...classes].sort().join(",")].join("\u0000");
}

/**
 * 云端 HTTP 基址（2026-10-04 · 乙阶段：广播投递改走云端，不再经 CIMS）。
 * 从 PUBLIC_CLOUD_WS_URL（ws://host:8788）推导：ws → http，其余不变。
 * ⚠️ 2026-10-08 修复：原来只做 ws→http 替换、**保留路径**。而 PUBLIC_CLOUD_WS_URL
 * 配的是 `wss://host/ws/agent`（WebSocket 握手路径），于是所有 `${base}/api/...`
 * 调用拼成 `/ws/agent/api/...`，实测返回 404 —— 设备在线状态、全校广播、回执对账、
 * 定时广播调度全部静默失效（调度器还把 404 当成功标已执行，假成功）。
 * 现在剥掉路径只留 origin（协议+主机+端口）：HTTP API 挂根路径，/ws/agent 只属于 WS 握手。
 * 云端 HTTP 端口同 WS 端口（8788），站点与云端同机（127.0.0.1）。
 * ⚠️ PUBLIC_ 前缀变量属于 $env/dynamic/public（SvelteKit 会把 PUBLIC_ 从
 * private_env 里剔除）——所以这里必须用 publicEnv 读，用 privateEnv 读永远是 undefined。
 */
export function cloudHttpBase(): string | null {
	const ws = (publicEnv.PUBLIC_CLOUD_WS_URL ?? "").trim();
	if (!ws) return null;
	try {
		const u = new URL(ws);
		u.protocol = u.protocol === "wss:" ? "https:" : "http:";
		u.pathname = "/";
		u.search = "";
		u.hash = "";
		return u.toString().replace(/\/$/, "");
	} catch {
		// 非法 URL 兜底：至少换协议，不抛
		return ws.replace(/^ws:\/\//i, "http://").replace(/^wss:\/\//i, "https://").replace(/\/$/, "");
	}
}

/** 云端 HTTP 管理面 Bearer 令牌（与云端 .env 的 CLOUD_VIEWER_TOKEN 同值，2026-10-04 鉴权）。 */
export function cloudViewerToken(): string {
	return (privateEnv.CLOUD_VIEWER_TOKEN ?? "").trim();
}

/** 云端在线设备 uid 列表（替代 CIMS listClientUids，全校广播用）。取不到返回 []。 */
async function cloudDeviceUids(): Promise<string[]> {
	const base = cloudHttpBase();
	if (!base) return [];
	try {
		const r = await fetch(`${base}/api/devices`, {
			headers: { Authorization: `Bearer ${cloudViewerToken()}` },
			signal: AbortSignal.timeout(5000)
		});
		if (!r.ok) return [];
		const d = (await r.json()) as { devices?: { uid?: string }[] };
		if (!Array.isArray(d.devices)) return [];
		return d.devices.map((x) => String(x.uid ?? "")).filter((x) => x.length > 0);
	} catch {
		return [];
	}
}

/**
 * 云端设备在线表（2026-10-05 · devices 页在线状态的自由来源）。
 * 返回 uid → { online, version, lastSeenAgoSec }；云端不可达 → {}（在线状态未知，设备列表仍显示）。
 */
export async function cloudDeviceStatus(): Promise<Record<string, { online: boolean; version: string; lastSeenAgoSec: number }>> {
	const base = cloudHttpBase();
	if (!base) return {};
	try {
		const r = await fetch(`${base}/api/devices`, {
			headers: { Authorization: `Bearer ${cloudViewerToken()}` },
			signal: AbortSignal.timeout(5000)
		});
		if (!r.ok) return {};
		const d = (await r.json()) as { devices?: { uid?: string; online?: boolean; version?: string; lastSeenAgoSec?: number }[] };
		if (!Array.isArray(d.devices)) return {};
		const out: Record<string, { online: boolean; version: string; lastSeenAgoSec: number }> = {};
		for (const x of d.devices) {
			const uid = String(x.uid ?? "").trim();
			if (!uid) continue;
			out[uid] = { online: !!x.online, version: String(x.version ?? ""), lastSeenAgoSec: Number(x.lastSeenAgoSec ?? 0) };
		}
		return out;
	} catch {
		return {};
	}
}

/**
 * 向一台设备下发 notify 指令（走云端 WS 指令通道）。
 * 返回 "sent" = 云端 200（已写进设备连接，等回执）/ "offline" = 云端 409（设备不在线）
 * / "error" = 云端不可达或网络异常。
 */
async function pushNotifyToDevice(
	base: string,
	uid: string,
	kind: string,
	title: string,
	content: string,
	seconds: number,
	noticeId: unknown,
	flags: Record<string, unknown>
): Promise<"sent" | "offline" | "error"> {
	try {
		const r = await fetch(`${base}/api/instructions`, {
			method: "POST",
			headers: { "content-type": "application/json", Authorization: `Bearer ${cloudViewerToken()}` },
			body: JSON.stringify({
				uid,
				action: "notify",
				params: {
					kind,
					title,
					content,
					...(seconds > 0 ? { seconds } : {}),
					...(noticeId !== undefined && noticeId !== null ? { notice_id: noticeId } : {}),
					flags
				}
			}),
			signal: AbortSignal.timeout(5000)
		});
		if (r.status === 200) return "sent";
		if (r.status === 409) return "offline";
		return "error";
	} catch {
		return "error";
	}
}

interface ClassMap {
	classes: { class_id: string; name: string; devices: string[] }[];
}

/**
 * 取「设备 ↔ 班级」映射。
 *
 * 2026-10-04（取代 CIMS）：数据源切到自有 `stelarith/devices.ts`（本地 device_bindings
 * 优先，CIMS 兜底）。`resolveDeviceClassMap` 返回的 `devices` 保留**原始大小写**
 * （本地表存的即是登记时的原样 uid），是下发指令前解析真实 uid 的唯一依据
 * （见 canonicalUid 说明）。自己解析再照抄 uid → 指令落进没人轮询的离线记录，
 * 设备永远收不到 —— 这正是「通知假闭环」的根因。
 */
async function fetchClassMap(): Promise<ClassMap | null> {
	const m = await resolveDeviceClassMap();
	if (!m) return null;
	const byClass = new Map<string, { class_id: string; name: string; devices: string[] }>();
	for (const c of m.classes) {
		byClass.set(c.class_id, { class_id: c.class_id, name: c.name, devices: [] });
	}
	for (const d of m.devices) {
		if (!d.class_id) continue;
		let e = byClass.get(d.class_id);
		if (!e) {
			e = { class_id: d.class_id, name: d.class_id, devices: [] };
			byClass.set(d.class_id, e);
		}
		e.devices.push(d.uid);
	}
	return { classes: [...byClass.values()] };
}

/**
 * 把「目标班级」解析成设备 uid 集合。
 * 班级标识接受 `class_id`（如 `class_3p1`）或班级名（如「高一(3)班」）两种写法，
 * 匹配不上就跳过（宁可不推，也不要因为解析失败退化成全校广播）。
 */
export function resolveClassTargets(
	map: ClassMap | null,
	classes: string[]
): { uids: string[]; matched: string[]; missed: string[] } {
	const want = classes.map((c) => String(c).trim()).filter(Boolean);
	const uids = new Set<string>();
	const matched: string[] = [];
	const missed: string[] = [];
	if (!map) return { uids: [], matched, missed: want };

	for (const w of want) {
		const hit = map.classes.filter((c) => c.class_id === w || c.name === w);
		if (hit.length === 0) {
			missed.push(w);
			continue;
		}
		for (const c of hit) {
			matched.push(c.class_id);
			for (const d of c.devices) uids.add(d);
		}
	}
	return { uids: [...uids], matched, missed };
}

/**
 * 把一条消息推送到教室端。
 *
 * @param title   通知标题（大屏遮罩文案）
 * @param content 通知正文（可空）
 * @param opts.targets 指定设备 uid 列表；空/未传 = 全部设备（或按 classes 解析）
 * @param opts.classes 目标班级（class_id 或班级名）。传了就等于「定向推送」，
 *                     只推这些班的设备；解析不到任何设备时**不推送**并返回 error。
 * @param opts.scope   留痕用的范围标签（"全校" / "高一(3)班" / …）
 * @param opts.source  来源通道标签（"announcement" / "chat" / "notice" / "manual"）
 * @param opts.author  发起人显示名（留痕用）
 * @param opts.force   跳过去重窗口，强制重新下发
 * @param opts.seconds 教室大屏显示时长（秒）。未传 = 不指定该字段，由 CIMS 默认值与
 *                     教室端插件「按正文字数自适应」决定。显式 >0 时严格照用。
 */
export async function broadcastToClassrooms(
	title: string,
	content = "",
	opts: {
		targets?: string[];
		classes?: string[];
		scope?: string;
		source?: string;
		author?: string;
		force?: boolean;
		seconds?: number;
		/** v2.1 通知类型：island / popup / fullscreen 走 stelarith_task 结构化信封；否则普通字符串。 */
		type?: string;
		/** 类型化旗标（解析渲染参数用）。 */
		flags?: Record<string, unknown>;
	} = {}
): Promise<BroadcastResult> {
	const cleanTitle = (title || "").trim();
	if (!cleanTitle) return { ok: false, delivered: 0, total: 0, error: "标题为空" };

	const classes = (opts.classes ?? []).map((c) => String(c).trim()).filter(Boolean);

	// ── 短时去重：同一内容 + 同一目标，窗口内只下发一次 ──────────────────────
	if (!opts.force) {
		const key = dedupeKey(cleanTitle, content, classes);
		const now = Date.now();
		// 顺手清过期项，避免 Map 无界增长
		for (const [k, t] of recentBroadcasts) if (now - t > DEDUPE_WINDOW_MS) recentBroadcasts.delete(k);
		const last = recentBroadcasts.get(key);
		if (last !== undefined && now - last < DEDUPE_WINDOW_MS) {
			// 命中去重：不推、不留痕 —— 否则历史里又多一条，等于换个地方重复。
			return { ok: true, delivered: 0, total: 0, deduped: true };
		}
		recentBroadcasts.set(key, now);
	}

	const cloudBase = cloudHttpBase();
	const cloudOk = !!cloudBase;

	let uids: string[] = opts.targets?.filter(Boolean) ?? [];
	let classNote = "";

	// 定向：把班级解析成设备。解析失败/无设备一律不推送（绝不退化成全校广播）。
	// 班级映射已是自有（本地 device_bindings 优先），无需 CIMS；但**只有云端可用时**才推。
	if (cloudOk && classes.length > 0) {
		const map = await fetchClassMap();
		const { uids: resolved, matched, missed } = resolveClassTargets(map, classes);
		classNote = missed.length ? `未匹配班级：${missed.join("、")}` : "";
		if (resolved.length === 0) {
			const notice = await addNotice({
				title: cleanTitle,
				scope: opts.scope || classes.join("、"),
				author: opts.author,
				sent: 0,
				classes,
				channel: opts.source || "manual"
			});
			await addAudit({
				action: "broadcast_" + (opts.source || "manual"),
				target: classes.join("、"),
				detail: `定向班级无可推送设备，未下发：${classNote || cleanTitle}`.slice(0, 200)
			});
			return {
				ok: false,
				delivered: 0,
				total: 0,
				notice,
				error: classNote || "目标班级下没有已绑定设备"
			};
		}
		uids = resolved;
		classNote = matched.length ? `命中班级 ${matched.length} 个` : "";
	}

	// 未指定 targets 也未指定 classes = 全量（云端在线设备表）
	if (cloudOk && uids.length === 0 && classes.length === 0) {
		uids = await cloudDeviceUids();
	}

	if (!cloudBase) {
		// 无云端配置：只留痕，让上层知道没送到
		const notice = await addNotice({
			title: cleanTitle,
			scope: opts.scope || "全校",
			author: opts.author,
			sent: 0,
			classes,
			channel: opts.source || "manual"
		});
		await addAudit({
			action: "broadcast_" + (opts.source || "manual"),
			target: opts.scope || "全校",
			detail: `云端未配置，仅留痕：${cleanTitle}`
		});
		return { ok: false, delivered: 0, total: uids.length, notice, error: "云端未配置" };
	}

	// ── 建档（2026-10-04 起 typed 与普通统一开局建档）────────────────────────
	// 之前只有类型化通知先建档拿 notice_id；普通通知走末尾 addNotice，无法逐台记录。
	// 现在两种都先建档：拿稳定 notice_id 下发时携带（设备回执对账），
	// 并给全部目标设备 ensureNoticeDeliveries 落 pending 行 —— 离线/失败有地方标。
	const typed = ["island", "popup", "fullscreen"].includes(opts.type || "")
		? (opts.type as "island" | "popup" | "fullscreen")
		: null;
	let typingNotice: ConsoleNotice | null = null;
	if (typed) {
		typingNotice = await addNotice({
			title: cleanTitle,
			scope: opts.scope || (classes.length ? classes.join("、") : "全校"),
			author: opts.author,
			sent: 0,
			classes,
			channel: opts.source || "manual",
			type: typed,
			flags: opts.flags
		});
	} else {
		// 普通通知同样开局建档（拿 id 用于逐台回执；末尾不再重复 addNotice）
		typingNotice = await addNotice({
			title: cleanTitle,
			scope: opts.scope || (classes.length ? classes.join("、") : "全校"),
			author: opts.author,
			sent: 0,
			classes,
			channel: opts.source || "manual"
		});
	}

	// ── uid 规范化（下发前必过的一手）────────────────────────────────────────
	// 设备把 uid 当**区分大小写**的键：同一台机器常并存两条记录 ——
	// 桌面端按主机名注册 `N7-20091211`（在线）、旧 ClassIsland 插件按小写注册
	// `n7-20091211`（早已离线）。照抄小写下发 → 上游回 200「通知已递送」，
	// 指令却落进那条没人轮询的离线记录：设备永远收不到，回执永远 pending。
	// 所以这里统一过 canonical 解析，解析成真实登记的那个大小写再发。
	// （2026-09-30 实测：大写 uid 6 秒送达并落盘；小写 150 秒毫无动静。）
	const deviceMap = await resolveDeviceClassMap();
	let uidFixed = 0;
	const seenUid = new Set<string>();
	const canonicalUids: string[] = [];
	for (const u of uids) {
		const c = selfCanonicalUid(u); // 保留原样（精确命中优先是查询侧的事）
		const real = deviceMap?.devices?.find((d) => d.uid === u)?.uid
			?? deviceMap?.devices?.find((d) => d.uid.toLowerCase() === u.toLowerCase())?.uid
			?? c;
		if (real !== u) uidFixed++;
		if (real && !seenUid.has(real)) {
			seenUid.add(real);
			canonicalUids.push(real);
		}
	}
	uids = canonicalUids;
	if (uidFixed > 0) {
		classNote = `${classNote ? classNote + "；" : ""}uid 大小写已按登记值校正 ${uidFixed} 台`;
	}

	// 开局建档：给全部目标设备落 pending 回执行（普通通知现在也建档，2026-10-04）。
	// 之后离线/失败有地方标 failed，老师能在回执表看到"哪台没收到"。
	const noticeId = typingNotice?.id ?? 0;
	if (noticeId) await ensureNoticeDeliveries(noticeId, uids);

	let delivered = 0;
	const kind = typed ?? "popup";
	for (const uid of uids) {
		// 2026-10-04（乙阶段）：投递走云端 WS 指令通道（action=notify），不再经 CIMS。
		// sent=已写进设备连接（保持 pending 等回执）；offline=设备离线（标 failed，detail 说明）；
		// error=云端不可达（标 failed，detail 说明）。
		const st = await pushNotifyToDevice(
			cloudBase,
			uid,
			kind,
			cleanTitle,
			content,
			typeof opts.seconds === "number" ? opts.seconds : 0,
			typed && typingNotice ? typingNotice.id : undefined,
			opts.flags ?? {}
		);
		if (st === "sent") {
			delivered++;
		} else if (noticeId) {
			await markNoticeDelivery(
				noticeId,
				uid,
				"failed",
				"",
				st === "offline" ? "设备离线未送达" : "云端不可达，指令未下发"
			);
		}
	}

	// 留痕（唯一收口 —— 调用方请用返回值，不要再自己写一条）
	// 2026-10-04：普通通知也已开局建档（见上），这里统一回填送达数，不再重复 addNotice。
	await setNoticeSent(noticeId, delivered);
	// 2026-10-04：异步对账——把设备真执行的回执（done）关联回通知表，pending → delivered。
	// 不 await：广播主链路已返回，对账是增强；对账失败不影响下发结果与留痕。
	if (noticeId && delivered > 0) {
		void await reconcileNoticeReceipts(noticeId, uids);
	}
	const notice = typingNotice ? { ...typingNotice, sent: delivered } : undefined;
	await addAudit({
		action: "broadcast_" + (opts.source || "manual"),
		target: opts.scope || (classes.length ? classes.join("、") : "全校"),
		detail: `推送到 ${delivered}/${uids.length} 台设备${classNote ? "（" + classNote + "）" : ""}${typed ? `（${typed}）` : ""}：${cleanTitle}`.slice(0, 200)
	});
	return { ok: delivered > 0, delivered, total: uids.length, notice, uids };
}

/**
 * 回执对账（2026-10-04）：广播发出后，把「设备真执行的回执」关联回通知表。
 *
 * 背景：站点发指令时携带 notice_id，被控端执行完回 done → 云端指令表 settle（state=done）。
 * 这里调云端 `GET /api/instructions/notice?notice_id=`（**直接查指令表**，不依赖事件流——
 * 事件流 50 条上限会被每 2 秒的帧事件刷掉，实测拉不到回执），把匹配的
 * pending 行推进到 delivered（设备真收到并执行）/ failed（执行失败）。
 *
 * 为什么异步 + 延迟：指令刚下发时设备可能还在处理，立即拉大概率拿不到回执；
 * 拉 3 次（约 1s/3s/8s）覆盖大多数教室机。拉不到就保持 pending（前端显示"待送达"，
 * 比假装成功诚实）。云端不可达/未配置 → 静默跳过（下发路径已留痕，这里只是增强）。
 */
export async function reconcileNoticeReceipts(
	noticeId: number,
	uids: string[],
	{ attempts = 3, intervalMs = 1500 } = {}
): Promise<void> {
	const base = cloudHttpBase();
	const token = cloudViewerToken();
	if (!base || !token || !noticeId || !uids.length) return;
	const nid = Number(noticeId);

	for (let i = 0; i < attempts; i++) {
		await new Promise((res) => setTimeout(res, intervalMs * (i + 1)));
		try {
			const r = await fetch(`${base}/api/instructions/notice?notice_id=${nid}`, {
				headers: { Authorization: `Bearer ${token}` },
				signal: AbortSignal.timeout(4000)
			});
			if (!r.ok) continue;
			const body = (await r.json()) as { ok?: boolean; receipts?: { uid: string; state: string; result: string }[] };
			const receipts = body.receipts ?? [];
			let hit = 0;
			for (const rec of receipts) {
				const uid = String(rec.uid ?? "").trim().toLowerCase();
				if (!uid || !uids.some((x) => x.trim().toLowerCase() === uid)) continue;
				const done = rec.state === "done" || rec.result === "done";
				await markNoticeDelivery(nid, uid, done ? "delivered" : "failed", "", done ? "" : "设备执行失败");
				hit++;
			}
			if (hit > 0) return;   // 对账到至少一条就收工（其余保持 pending，前端可见）
		} catch {
			/* 单次拉取失败不重试整批：降级为保持 pending，下发链路的留痕不受影响 */
		}
	}
}
