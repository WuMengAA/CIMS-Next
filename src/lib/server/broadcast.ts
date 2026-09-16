import { env } from "$env/dynamic/private";
import { getCimsAccount } from "./cims-account.js";
import { addNotice, addAudit, type ConsoleNotice } from "./console-ext.js";

// ── 广播下发（把站内公告/消息推送到 CIMS 教室端大屏）────────────────────────
//
// 设计要点（为什么放在服务端而不是面板里）：
//   面板里的 sendNotice 是「人在页面上手动敲一条」——那只是通道，不是自动化。
//   真正需要的是：网站侧发生一件事（发公告、发通知、电教委员在群里喊话），
//   教室端**自动**收到，不需要任何人再手动转一遍。
//
// 链路：
//   网站事件 → 本模块 → CIMS management `/account/{acct}/client/{uid}/command/send-notification`
//                    → CIMS 写 command_queue
//                    → 教室端插件轮询取走 → StelarithNotificationProvider 上大屏
//
// 两条降级路径（都不能让上层调用失败）：
//   ① CIMS 未配置 / 不可达 → 只留痕到 console_notices，返回 delivered:0
//   ② 单台设备失败 → 跳过该台，继续推其余设备
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

async function cimsLogin(): Promise<{ mgmt: string; token: string } | null> {
	const mgmt = (env.CIMS_MANAGEMENT_URL ?? "http://127.0.0.1:8097").replace(/\/$/, "");
	const email = env.CIMS_ADMIN_EMAIL ?? "";
	const password = env.CIMS_ADMIN_PASSWORD ?? "";
	if (!email || !password) return null;
	try {
		const r = await fetch(`${mgmt}/user/auth`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email, password }),
			signal: AbortSignal.timeout(5000)
		});
		if (!r.ok) return null;
		const { token } = (await r.json()) as { token?: string };
		return token ? { mgmt, token } : null;
	} catch {
		return null;
	}
}

/** 列出 CIMS 侧全部客户端 uid（用于「全校广播」）。 */
async function listClientUids(mgmt: string, token: string, accountId: string): Promise<string[]> {
	try {
		const r = await fetch(`${mgmt}/account/${accountId}/client/list`, {
			headers: { Authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(5000)
		});
		if (!r.ok) return [];
		const list = (await r.json()) as unknown;
		if (!Array.isArray(list)) return [];
		return list
			.map((x) => (typeof x === "string" ? x : (x as { uid?: string; id?: string })?.uid ?? (x as { id?: string })?.id))
			.filter((x): x is string => typeof x === "string" && x.length > 0);
	} catch {
		return [];
	}
}

interface ClassMap {
	classes: { class_id: string; name: string; devices: string[] }[];
}

/** 取「设备 ↔ 班级」映射（CIMS `/class/device-map`）。 */
async function fetchClassMap(mgmt: string, token: string): Promise<ClassMap | null> {
	try {
		const r = await fetch(`${mgmt}/class/device-map`, {
			headers: { Authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(5000)
		});
		if (!r.ok) return null;
		const data = (await r.json()) as ClassMap;
		return Array.isArray(data?.classes) ? data : null;
	} catch {
		return null;
	}
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

	const acct = await getCimsAccount();
	const auth = acct ? await cimsLogin() : null;

	let uids: string[] = opts.targets?.filter(Boolean) ?? [];
	let classNote = "";

	// 定向：把班级解析成设备。解析失败/无设备一律不推送（绝不退化成全校广播）。
	if (auth && classes.length > 0) {
		const map = await fetchClassMap(auth.mgmt, auth.token);
		const { uids: resolved, matched, missed } = resolveClassTargets(map, classes);
		classNote = missed.length ? `未匹配班级：${missed.join("、")}` : "";
		if (resolved.length === 0) {
			const notice = addNotice({
				title: cleanTitle,
				scope: opts.scope || classes.join("、"),
				author: opts.author,
				sent: 0,
				classes,
				channel: opts.source || "manual"
			});
			addAudit({
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

	// 未指定 targets 也未指定 classes = 全量
	if (auth && acct && uids.length === 0 && classes.length === 0) {
		uids = await listClientUids(auth.mgmt, auth.token, acct.id);
	}

	if (!auth || !acct) {
		// 无 CIMS：只留痕，让上层知道没送到
		const notice = addNotice({
			title: cleanTitle,
			scope: opts.scope || "全校",
			author: opts.author,
			sent: 0,
			classes,
			channel: opts.source || "manual"
		});
		addAudit({
			action: "broadcast_" + (opts.source || "manual"),
			target: opts.scope || "全校",
			detail: `CIMS 未配置/不可达，仅留痕：${cleanTitle}`
		});
		return { ok: false, delivered: 0, total: uids.length, notice, error: "CIMS 不可达" };
	}

	let delivered = 0;
	for (const uid of uids) {
		try {
			const r = await fetch(
				`${auth.mgmt}/account/${acct.id}/client/${encodeURIComponent(uid)}/command/send-notification`,
				{
					method: "POST",
					headers: {
						"content-type": "application/json",
						Authorization: `Bearer ${auth.token}`
					},
					body: JSON.stringify({ MessageContent: content ? `${cleanTitle}\n${content}` : cleanTitle }),
					signal: AbortSignal.timeout(5000)
				}
			);
			if (r.ok) delivered++;
		} catch {
			/* 单台失败跳过 */
		}
	}

	// 留痕（唯一收口 —— 调用方请用返回值，不要再自己写一条）
	const notice = addNotice({
		title: cleanTitle,
		scope: opts.scope || (classes.length ? classes.join("、") : "全校"),
		author: opts.author,
		sent: delivered,
		classes,
		channel: opts.source || "manual"
	});
	addAudit({
		action: "broadcast_" + (opts.source || "manual"),
		target: opts.scope || (classes.length ? classes.join("、") : "全校"),
		detail: `推送到 ${delivered}/${uids.length} 台设备${classNote ? "（" + classNote + "）" : ""}：${cleanTitle}`.slice(0, 200)
	});
	return { ok: delivered > 0, delivered, total: uids.length, notice };
}
