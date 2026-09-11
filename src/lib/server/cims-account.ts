import { env } from "$env/dynamic/private";

// 解析 CIMS 首个账户（用于内嵌面板注入 accountId，以及客户端 Host 头所需的 slug）。
// 缓存模块级，避免每次页面加载都登录一次 CIMS。
let cached: { id: string; slug: string } | null = null;
let inflight: Promise<{ id: string; slug: string } | null> | null = null;

export async function getCimsAccount(): Promise<{ id: string; slug: string } | null> {
	if (cached) return cached;
	if (inflight) return inflight;
	inflight = (async () => {
		const mgmt = (env.CIMS_MANAGEMENT_URL ?? "http://127.0.0.1:8097").replace(/\/$/, "");
		const email = env.CIMS_ADMIN_EMAIL ?? "techrep01@test.com";
		const password = env.CIMS_ADMIN_PASSWORD ?? "TestPass123456";
		try {
			const r = await fetch(`${mgmt}/user/auth`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ email, password }),
			});
			if (!r.ok) return null;
			const { token } = (await r.json()) as { token?: string };
			if (!token) return null;
			const lr = await fetch(`${mgmt}/account/list`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (!lr.ok) return null;
			const list = (await lr.json()) as Array<{ id: string; slug?: string }>;
			if (Array.isArray(list) && list.length) {
				cached = { id: list[0].id, slug: list[0].slug ?? "" };
				return cached;
			}
		} catch {
			/* 忽略：CIMS 不可达时返回 null，面板自动降级 */
		}
		return null;
	})();
	try {
		return await inflight;
	} finally {
		inflight = null;
	}
}
