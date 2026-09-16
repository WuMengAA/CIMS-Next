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
		// 凭据只从环境变量读取（.env，未入库），此处刻意不留字面量兜底：
		// 一旦在这里写死，服务账号就会随源码进入公开仓库（本站曾因此泄漏过一次）。
		const email = env.CIMS_ADMIN_EMAIL ?? "";
		const password = env.CIMS_ADMIN_PASSWORD ?? "";
		if (!email || !password) {
			console.warn("[cims] CIMS_ADMIN_EMAIL / CIMS_ADMIN_PASSWORD 未配置，跳过账户解析（面板自动降级）");
			return null;
		}
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

/**
 * 跨系统账号**变更**同步：website 改资料/角色/停启用/班级年级后，镜像到 CIMS。
 *
 * 与 syncUserToCims（新建）互补：那条只在注册时跑（因为要拿明文密码），
 * 这条用于后续所有变更，故不含密码字段（除非显式改密码）。
 *
 * 角色映射的**唯一权威**在 CIMS 侧（`WEBSITE_ROLE_TO_CIMS`，
 * 见 CIMS-backend/app/api/management/user_sync.py）：website 只报自己的角色名，
 * CIMS 负责降级映射（未知角色一律落 viewer，绝不提权）。这样以后 website 新增角色
 * 只需改 CIMS 那张表，不必改动本站——也避免了网站侧被篡改后反向提权。
 *
 * fail-open：CIMS 不可达不阻断网站侧操作，仅记日志；CIMS 侧幂等，重放安全。
 */
export async function syncUserUpdateToCims(input: {
	email: string;
	password?: string;
	username?: string;
	displayName?: string;
	/** website 侧角色名（admin/editor/moderator/techrep/user/viewer…），由 CIMS 映射 */
	role?: string;
	/** 是否启用（停用即禁止登录 CIMS） */
	active?: boolean;
	/** 班级名（如「高一(3)班」），CIMS 侧写入该用户所属 Account 空间名 */
	className?: string;
	/** 年级名（如「高二」） */
	gradeName?: string;
}): Promise<{ ok: boolean; updated?: string[]; error?: string }> {
	const mgmt = (env.CIMS_MANAGEMENT_URL ?? "http://127.0.0.1:8097").replace(/\/$/, "");
	const key = env.CIMS_SYNC_KEY ?? "";
	if (!key) {
		console.warn("[cims-sync] CIMS_SYNC_KEY 未配置，跳过同步");
		return { ok: false, error: "CIMS_SYNC_KEY not configured" };
	}
	// 只发有值的字段：CIMS 侧把「未提供的键」视为「不要改」，
	// 传 null/undefined 会被 JSON.stringify 丢掉，正好符合语义。
	const payload: Record<string, unknown> = { email: input.email };
	if (input.password) payload.password = input.password;
	if (input.username !== undefined) payload.username = input.username;
	if (input.displayName !== undefined) payload.display_name = input.displayName;
	if (input.role !== undefined) payload.role = input.role;
	if (input.active !== undefined) payload.status = input.active ? "active" : "disabled";
	if (input.className !== undefined) payload.class_name = input.className;
	if (input.gradeName !== undefined) payload.grade_name = input.gradeName;

	try {
		const r = await fetch(`${mgmt}/user/sync-update`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-cims-sync-key": key
			},
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(5000)
		});
		if (!r.ok) {
			const t = await r.text();
			console.error(`[cims-sync] update CIMS ${r.status}: ${t.slice(0, 200)}`);
			return { ok: false, error: `CIMS ${r.status}` };
		}
		const data = (await r.json()) as { ok?: boolean; updated_fields?: string[] };
		return { ok: true, updated: data.updated_fields ?? [] };
	} catch (e) {
		console.error("[cims-sync] update 调用失败（CIMS 不可达？）:", e);
		return { ok: false, error: "unreachable" };
	}
}
