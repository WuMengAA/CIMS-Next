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

/**
 * 跨系统账号同步：website 注册后把账号镜像到 CIMS（website 为账号权威）。
 *
 * 为什么在 register 而不是 verify：website 库里密码只存 sha+salt 哈希，
 * 明文只在注册请求体中出现这一次；CIMS 侧需要明文自行 Argon2id 哈希，
 * 所以镜像必须在这一刻完成。
 *
 * fail-open：CIMS 不可达不应让 website 注册失败，失败仅记日志；
 * CIMS 侧 /user/sync-create 幂等（邮箱已存在返回 created:false），重放安全。
 */
export async function syncUserToCims(input: {
	email: string;
	password: string;
	username?: string;
	displayName?: string;
}): Promise<{ ok: boolean; created?: boolean; error?: string }> {
	const mgmt = (env.CIMS_MANAGEMENT_URL ?? "http://127.0.0.1:8097").replace(/\/$/, "");
	const key = env.CIMS_SYNC_KEY ?? "";
	if (!key) {
		console.warn("[cims-sync] CIMS_SYNC_KEY 未配置，跳过同步");
		return { ok: false, error: "CIMS_SYNC_KEY not configured" };
	}
	try {
		const r = await fetch(`${mgmt}/user/sync-create`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-cims-sync-key": key
			},
			body: JSON.stringify({
				email: input.email,
				password: input.password,
				username: input.username ?? "",
				display_name: input.displayName ?? ""
			}),
			signal: AbortSignal.timeout(5000)
		});
		if (!r.ok) {
			const t = await r.text();
			console.error(`[cims-sync] CIMS ${r.status}: ${t.slice(0, 200)}`);
			return { ok: false, error: `CIMS ${r.status}` };
		}
		const data = (await r.json()) as { ok?: boolean; created?: boolean };
		return { ok: true, created: data.created };
	} catch (e) {
		console.error("[cims-sync] 调用失败（CIMS 不可达？）:", e);
		return { ok: false, error: "unreachable" };
	}
}
