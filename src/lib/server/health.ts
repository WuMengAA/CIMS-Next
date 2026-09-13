// 内部服务存活探测：用于后台「服务存活状态」页（/admin/health）。
// 探测目标可在部署环境用 HEALTH_ENDPOINTS（JSON 数组 [{name,url}]）自定义，
// 否则默认探测「网站自身」与「CIMS 集控（8097）」两个核心 API。

export interface ServiceStatus {
	name: string;
	url: string;
	alive: boolean;
	status: number | null;
	ms: number | null;
	error?: string;
}

function getServiceList(): { name: string; url: string }[] {
	const env = process.env.HEALTH_ENDPOINTS;
	if (env) {
		try {
			const parsed = JSON.parse(env);
			if (Array.isArray(parsed)) {
				return parsed
					.filter((x: any) => x && typeof x.url === "string")
					.map((x: any) => ({ name: String(x.name || x.url), url: String(x.url) }));
			}
		} catch {
			/* fall through to defaults */
		}
	}
	// 「网站自身」优先探测本机监听地址（127.0.0.1:PORT），而非外网 PUBLIC_SITE_URL：
	// 后者要经过 DNS/CDN 出网回环，在受限网络下会稳定超时，导致存活页对「自己」误报异常。
	// 需要探测外网可达性时，用 HEALTH_SELF_URL 或 HEALTH_ENDPOINTS 显式指定。
	const port = process.env.PORT || "8090";
	const self = process.env.HEALTH_SELF_URL || `http://127.0.0.1:${port}`;
	const cims = process.env.CIMS_BASE || "http://127.0.0.1:8097";
	return [
		{ name: "网站 (Website)", url: self },
		{ name: "CIMS 集控 (8097)", url: cims }
	];
}

export async function probeServices(): Promise<ServiceStatus[]> {
	const list = getServiceList();
	return Promise.all(
		list.map(async (s): Promise<ServiceStatus> => {
			const start = Date.now();
			const ctrl = new AbortController();
			const timer = setTimeout(() => ctrl.abort(), 3000);
			try {
				const res = await fetch(s.url, { method: "GET", signal: ctrl.signal });
				clearTimeout(timer);
				const ms = Date.now() - start;
				return { name: s.name, url: s.url, alive: res.status >= 200 && res.status < 400, status: res.status, ms };
			} catch (e: any) {
				clearTimeout(timer);
				const ms = Date.now() - start;
				const err = e?.name === "AbortError" ? "超时" : e?.message || "连接失败";
				return { name: s.name, url: s.url, alive: false, status: null, ms, error: err };
			}
		})
	);
}
