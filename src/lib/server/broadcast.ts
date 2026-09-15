import { env } from "$env/dynamic/private";
import { getCimsAccount } from "./cims-account.js";
import { addNotice, addAudit } from "./console-ext.js";

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

export interface BroadcastResult {
	ok: boolean;
	delivered: number;
	total: number;
	error?: string;
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

/**
 * 把一条消息推送到教室端。
 *
 * @param title   通知标题（大屏遮罩文案）
 * @param content 通知正文（可空）
 * @param opts.targets 指定设备 uid 列表；空/未传 = 全部设备
 * @param opts.scope   留痕用的范围标签（"全校" / "高一(3)班" / …）
 * @param opts.source  来源标签（"announcement" / "chat" / "manual"），写进审计
 */
export async function broadcastToClassrooms(
	title: string,
	content = "",
	opts: { targets?: string[]; scope?: string; source?: string } = {}
): Promise<BroadcastResult> {
	const cleanTitle = (title || "").trim();
	if (!cleanTitle) return { ok: false, delivered: 0, total: 0, error: "标题为空" };

	const acct = await getCimsAccount();
	const auth = acct ? await cimsLogin() : null;

	let uids: string[] = opts.targets?.filter(Boolean) ?? [];
	if (auth && acct && uids.length === 0) {
		uids = await listClientUids(auth.mgmt, auth.token, acct.id);
	}

	if (!auth || !acct) {
		// 无 CIMS：只留痕，让上层知道没送到
		addNotice({ title: cleanTitle, scope: opts.scope || "全校", sent: 0 });
		addAudit({
			action: "broadcast_" + (opts.source || "manual"),
			target: opts.scope || "全校",
			detail: `CIMS 未配置/不可达，仅留痕：${cleanTitle}`
		});
		return { ok: false, delivered: 0, total: uids.length, error: "CIMS 不可达" };
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

	addNotice({ title: cleanTitle, scope: opts.scope || "全校", sent: delivered });
	addAudit({
		action: "broadcast_" + (opts.source || "manual"),
		target: opts.scope || "全校",
		detail: `推送到 ${delivered}/${uids.length} 台设备：${cleanTitle}`
	});
	return { ok: delivered > 0, delivered, total: uids.length };
}
