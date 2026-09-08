import type { PageServerLoad } from "./$types";
import { env } from "$env/dynamic/private";

// 服务端拉取 voicehub 公开 API（API Key 仅服务端使用，不下发前端）。
// 契约（已在 voicehub 源码 server/api/open/* 核实）：
//   GET /api/open/songs?played=true&sortBy=playedAt&sortOrder=desc&limit=1  -> 当前播放
//   GET /api/open/songs?played=false&sortBy=createdAt&sortOrder=asc&limit=N  -> 待播队列
export const load: PageServerLoad = async () => {
	const base = (env.VOICEHUB_BASE || "").replace(/\/+$/, "");
	const key = env.VOICEHUB_KEY || "";
	if (!base || !key) {
		return { now: null, queue: [], configured: false };
	}
	try {
		const [nowR, qR] = await Promise.all([
			fetch(`${base}/api/open/songs?played=true&sortBy=playedAt&sortOrder=desc&limit=1`, {
				headers: { "x-api-key": key },
			}),
			fetch(`${base}/api/open/songs?played=false&sortBy=createdAt&sortOrder=asc&limit=20`, {
				headers: { "x-api-key": key },
			}),
		]);
		if (!nowR.ok || !qR.ok) {
			const status = !nowR.ok ? nowR.status : qR.status;
			// env 已就绪但 API 拒绝（如 401 未授权）：单独标记，便于前端区分"未配置"与"已配置但连接失败"
			return { now: null, queue: [], configured: true, error: true, errorStatus: status };
		}
		const nowJ = await nowR.json();
		const qJ = await qR.json();
		const nowRaw = nowJ?.data?.songs?.[0] || null;
		const now = nowRaw
			? {
					title: nowRaw.title,
					artist: nowRaw.artist,
					by: nowRaw.requester,
					at: nowRaw.playedAtFormatted,
					cover: nowRaw.cover || null,
				}
			: null;
		const queue = (qJ?.data?.songs || []).map((s: any) => ({
			title: s.title,
			artist: s.artist,
			by: s.requester,
			votes: s.voteCount,
			at: s.requestedAt,
			cover: s.cover || null,
		}));
		return { now, queue, configured: true };
	} catch {
		// 网络异常等：env 已就绪但未能拿到数据
		return { now: null, queue: [], configured: true, error: true, errorStatus: null };
	}
};
