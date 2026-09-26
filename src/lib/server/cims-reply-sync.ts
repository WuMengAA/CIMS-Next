/**
 * 桌面端回执 → CIMS 聚合同步（2026-09-26）
 *
 * 背景：教室端插件（ClassIsland）的互动通知回执直接落 CIMS notice_replies 表，
 * 操控端从 CIMS 回复收件箱读取。而桌面端（老师电脑）的回复走网站 ext 通道
 * （落网站 SQLite notice_deliveries）——两条通道并存，操控端在 CIMS 收件箱
 * 看不到桌面端的回复。
 *
 * 本模块把「ext 收到的桌面端回复」同步转发到 CIMS：
 *   POST {CIMS_CLIENT_URL}/api/v1/client/{uid}/notice-reply
 *   带 Host: <slug>.<BaseDomain>（CIMS TenantMiddleware 按 Host 头识别租户）
 *   鉴权走服务端管理凭据换取的 Bearer token（CIMS 设备端点同样接受会话令牌）。
 *
 * 语义：
 *   · fire-and-forget：转发失败**不影响** ext 主流程（回复已落 ext 库，
 *     面板可见）；聚合是增强能力，不能因为 CIMS 暂时不可达让回复丢失；
 *   · 幂等近似：CIMS notice_replies 表按行追加，重复转发会产生重复行 ——
 *     因此只对「ext 首次记录」的回复触发同步（见调用方去重）。
 */
import { env } from "$env/dynamic/private";

const CLIENT_URL = (env.CIMS_CLIENT_URL ?? "http://127.0.0.1:8096").replace(/\/$/, "");
const BASE_DOMAIN = (env.CIMS_BASE_DOMAIN ?? "245959623.xyz").replace(/^\./, "").trim();
const SLUG = (env.CONSOLE_TARGET_SLUG ?? "demo-class").trim();

/**
 * 把一条桌面端回复同步到 CIMS notice_replies。
 * 返回 true = CIMS 已接收；false = 未配置/失败（调用方只记日志，不重试）。
 */
export async function syncReplyToCims(uid: string, noticeId: number, text: string): Promise<boolean> {
	const u = String(uid ?? "").trim();
	const nid = Number(noticeId ?? 0);
	const t = String(text ?? "").trim();
	if (!u || !nid || !t) return false;

	// 需要 CIMS 会话令牌（服务端凭据换取，见 cims-client.ts cimsToken）
	// ⚠️ 必须用 node:http 而不是 fetch：CIMS 租户识别靠 Host 头（<slug>.<BaseDomain>），
	// 而 fetch 的 Host 是 forbidden header（设置会被忽略/报错）。node:http 可自由设置。
	const { request } = await import("node:http");
	const { cimsToken, invalidateCimsToken } = await import("./cims-client.js");
	const token = await cimsToken();
	if (!token) return false;

	const host = `${SLUG}.${BASE_DOMAIN}`;
	const url = new URL(`${CLIENT_URL}/api/v1/client/${encodeURIComponent(u)}/notice-reply`);
	const body = JSON.stringify({ notice_id: String(nid), text: t });

	const doPost = (tk: string) =>
		new Promise<boolean>((resolve) => {
			const req = request(
				{
					hostname: url.hostname,
					port: url.port || undefined,
					path: url.pathname + url.search,
					method: "POST",
					headers: {
						Host: host,
						Authorization: `Bearer ${tk}`,
						"content-type": "application/json",
						"content-length": Buffer.byteLength(body)
					},
					timeout: 5000
				},
				(res) => {
					res.resume();
					resolve(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300);
				}
			);
			req.on("error", () => resolve(false));
			req.on("timeout", () => {
				req.destroy();
				resolve(false);
			});
			req.write(body);
			req.end();
		});

	try {
		let ok = await doPost(token);
		if (!ok) {
			// 401 重试一次（令牌可能过期）
			invalidateCimsToken();
			const t2 = await cimsToken();
			if (!t2) return false;
			ok = await doPost(t2);
		}
		return ok;
	} catch {
		return false;
	}
}
