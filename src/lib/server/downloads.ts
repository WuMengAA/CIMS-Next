/**
 * 下载中心的数据源（2026-10-06 加）。
 *
 * 为什么是「去云端取」而不是「站点里再存一份」：
 *   版本号 / 下载地址 / sha256 已经在云端 `ota.json` 里维护过一次了（被控端的升级提示也读它）。
 *   官网再存一份 → 两处必然漂移 —— 而"两份清单对不上"正是本项目的惯犯（见根目录 MEMORY）。
 *   所以官网读云端的**公开只读**端点 `/api/public/ota`：它不带鉴权、只回已经公开的信息
 *   （版本、公开下载 URL、大小、sha256、说明），不含任何令牌。发版时只改云端一处，
 *   官网自动跟着变。
 *
 * 取不到时的态度：如实返回 `published:false` + 原因，页面写"暂时取不到版本信息"。
 *   **不拿旧数据假装是最新** —— 下载页给出过期版本号比给不出更坏。
 */

const CLOUD_PUBLIC_BASE = process.env.CLOUD_PUBLIC_BASE || "https://control.245959623.xyz";

export type PublishedPackage = {
	version: string;
	url: string;
	size: number;
	sha256: string;
	notes: string;
	mandatory: boolean;
};

export type PublishState = { published: true; latest: PublishedPackage } | { published: false; error?: string };

export async function fetchPublished(product: "agent" | "viewer"): Promise<PublishState> {
	const url = `${CLOUD_PUBLIC_BASE}/api/public/ota?product=${product}`;
	try {
		// 3 秒超时：这是公开页，访客不该为云端慢而干等。
		const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
		if (!res.ok) return { published: false, error: `云端返回 HTTP ${res.status}` };
		const j = (await res.json()) as {
			ok?: boolean;
			published?: boolean;
			latest?: PublishedPackage | null;
		};
		if (!j || j.ok !== true) return { published: false, error: "云端返回了非预期内容" };
		if (!j.published || !j.latest || !j.latest.version) return { published: false };
		return { published: true, latest: j.latest };
	} catch (e) {
		return { published: false, error: (e as Error)?.message || "取不到云端版本信息" };
	}
}

/** 人类可读体积。服务端算一次，前端不再算（两边各算一遍最容易对不上）。 */
export function humanSize(n: number): string {
	if (!n || n <= 0) return "-";
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
	if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
	return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
