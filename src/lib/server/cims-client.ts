/**
 * CIMS 管理面共享客户端（班级系统 v2 抽取）。
 *
 * 此前「登录换令牌」「班级列表」「设备↔班级映射」这三段逻辑散在
 * cims 代理路由和 broadcast.ts 里各写一份（各自持有 token 缓存）。
 * v2 里新端点（/api/classes、绑定校验、file-push、回放范围判定）都需要它们，
 * 于是收口到一个模块 —— 已有的 broadcast.ts / 代理路由**不动**（在跑的代码
 * 不因重构而冒险），新代码一律走这里。
 *
 * 缓存策略：
 *   · token        —— 进程内缓存，401 时由调用方清空重取；
 *   · classList    —— 45s；绑定校验/班级下拉都吃它（真实班级，绝不掺演示数据）；
 *   · deviceClassMap —— 45s；「目标设备在不在我的班里」的范围判定靠它。
 */
import { env } from "$env/dynamic/private";

const MGMT = (env.CIMS_MANAGEMENT_URL ?? "http://127.0.0.1:8097").replace(/\/$/, "");
const EMAIL = env.CIMS_ADMIN_EMAIL ?? "";
const PASSWORD = env.CIMS_ADMIN_PASSWORD ?? "";
const CACHE_MS = 45_000;

export interface CimsClass {
	class_id: string;
	name: string;
	code?: string;
	class_plan?: string;
	device_count?: number;
}

export interface DeviceClassEntry {
	class_id?: string;
	name?: string;
	code?: string;
	[key: string]: unknown;
}

let token: string | null = null;
let renewing = false;

/** 登录换取 CIMS 会话令牌（进程内缓存）。未配置凭据 / 上游不可达 → null。 */
export async function cimsToken(): Promise<string | null> {
	if (token) return token;
	if (renewing || !EMAIL || !PASSWORD) return null;
	renewing = true;
	try {
		const r = await fetch(`${MGMT}/user/auth`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
			signal: AbortSignal.timeout(5000)
		});
		if (r.ok) {
			const data = (await r.json()) as { token?: string };
			token = data.token ?? null;
		}
	} catch {
		token = null;
	} finally {
		renewing = false;
	}
	return token;
}

/** 强制令牌过期（上游 401 时由调用方调用）。 */
export function invalidateCimsToken(): void {
	token = null;
}

/** 带 Bearer 的 CIMS GET；401 自动换令牌重试一次。失败返回 null（fail-soft）。 */
export async function cimsGet<T>(path: string): Promise<T | null> {
	const t = await cimsToken();
	if (!t) return null;
	const doFetch = async (tk: string) =>
		await fetch(`${MGMT}${path}`, {
			headers: { Authorization: `Bearer ${tk}` },
			signal: AbortSignal.timeout(5000)
		});
	let r = await doFetch(t);
	if (r.status === 401) {
		invalidateCimsToken();
		const t2 = await cimsToken();
		if (!t2) return null;
		r = await doFetch(t2);
	}
	if (!r.ok) return null;
	try {
		return (await r.json()) as T;
	} catch {
		return null;
	}
}

/** 带 Bearer 的 CIMS POST；401 自动换令牌重试一次。失败返回 null（fail-soft）。
 *  [extraHeaders] 用于补 Host 头（CIMS 租户识别靠 Host: <slug>.<BaseDomain>）。
 */
export async function cimsPost<T>(
	path: string,
	body: unknown,
	extraHeaders?: Record<string, string>
): Promise<T | null> {
	const t = await cimsToken();
	if (!t) return null;
	const doFetch = async (tk: string) =>
		await fetch(`${MGMT}${path}`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${tk}`,
				"content-type": "application/json",
				...(extraHeaders ?? {})
			},
			body: JSON.stringify(body ?? {}),
			signal: AbortSignal.timeout(5000)
		});
	let r = await doFetch(t);
	if (r.status === 401) {
		invalidateCimsToken();
		const t2 = await cimsToken();
		if (!t2) return null;
		r = await doFetch(t2);
	}
	if (!r.ok) return null;
	try {
		return (await r.json()) as T;
	} catch {
		return null;
	}
}

// ── 真实班级列表（45s 缓存）──────────────────────────────────────────────────

let classCache: { at: number; classes: CimsClass[] } | null = null;

/**
 * CIMS 真实班级列表。**绝不掺演示数据** —— 取不到就返回 null，
 * 由调用方决定如何报错（绑定/选班界面必须明示「CIMS 不可达」，
 * 不能像旧面板那样静默回退到「高一(1)班」假数据）。
 */
export async function fetchClassList(): Promise<CimsClass[] | null> {
	if (classCache && Date.now() - classCache.at < CACHE_MS) return classCache.classes;
	const data = await cimsGet<unknown>("/class/list");
	let classes: CimsClass[] | null = null;
	if (Array.isArray(data)) {
		classes = data as CimsClass[];
	} else if (data && typeof data === "object") {
		// 兼容 {classes: [...]} / {list: [...]} 两种信封
		const obj = data as { classes?: unknown; list?: unknown };
		const arr = Array.isArray(obj.classes) ? obj.classes : Array.isArray(obj.list) ? obj.list : null;
		classes = arr ? (arr as CimsClass[]) : null;
	}
	if (!classes) return null;
	classCache = { at: Date.now(), classes };
	return classes;
}

// ── 设备 ↔ 班级映射（45s 缓存；范围判定用）───────────────────────────────────

let mapCache: {
	at: number;
	uidToClass: Map<string, string>;
	/** 全部已登记设备（**保留 CIMS 原始大小写**）—— 下发指令必须按它取 uid。 */
	devices: { uid: string; class_id: string }[];
	classes: { class_id: string; name: string }[];
} | null = null;

/**
 * uid → class_id 映射（**匹配**键小写归一；CIMS 的 client_id 与 agent host 大小写不一，
 * 与 captures 双 key 的教训一致 —— 查询侧统一 toLowerCase）。
 *
 * ⚠️ 但**下发指令**（send-notification 等写操作）绝不能吃小写归一后的串：
 * CIMS 是把 uid 当**区分大小写的键**存的，同一台机器常常并存两条记录 ——
 * 桌面端按主机名注册 `N7-20091211`（在线），旧的 ClassIsland 插件按小写注册
 * `n7-20091211`（早已离线）。若一律小写下发，指令会落进那条**没人轮询的离线记录**：
 * CIMS 照样回 200「通知已递送」，设备却永远收不到，回执永远停在 pending。
 * 故本函数一并返回 [devices]（原始大小写），调用方按它解析出真实 uid 再下发。
 * （2026-09-30 实测：大写 uid 6 秒送达并落盘，小写 150 秒毫无动静。）
 */
export async function fetchDeviceClassMap(): Promise<{
	uidToClass: Map<string, string>;
	devices: { uid: string; class_id: string }[];
	classes: { class_id: string; name: string }[];
} | null> {
	if (mapCache && Date.now() - mapCache.at < CACHE_MS) return mapCache;
	const data = await cimsGet<{ devices?: Record<string, unknown>; classes?: unknown }>("/class/device-map");
	if (!data || typeof data !== "object") return null;
	const uidToClass = new Map<string, string>();
	const devices: { uid: string; class_id: string }[] = [];
	const raw = data.devices && typeof data.devices === "object" ? data.devices : {};
	for (const [uid, info] of Object.entries(raw)) {
		const cid =
			typeof info === "string"
				? info
				: ((info as DeviceClassEntry)?.class_id as string | undefined) ?? "";
		devices.push({ uid, class_id: cid });
		if (cid) uidToClass.set(uid.toLowerCase(), cid);
	}
	const classes = Array.isArray(data.classes)
		? (data.classes as { class_id?: string; name?: string }[])
				.filter((c) => c && c.class_id)
				.map((c) => ({ class_id: String(c.class_id), name: String(c.name ?? c.class_id) }))
		: [];
	mapCache = { at: Date.now(), uidToClass, devices, classes };
	return mapCache;
}

/**
 * 把任意大小写写法的 uid 解析成 CIMS 里真实登记的那一个（下发指令前必须过一手）。
 *
 * 规则：**精确命中优先** —— 传进来的串若本身就是一条真实记录（如 `N7-20091211`），
 * 原样返回；否则按小写去匹配（如传 `n7-20091211` 而库里只有大写）。两者都没有就原样返回，
 * 让 CIMS 自己去报错，不在这里凭空造 uid。
 */
export function canonicalUid(
	map: { devices: { uid: string }[] } | null | undefined,
	uid: string
): string {
	const want = String(uid ?? "").trim();
	if (!want) return want;
	const list = map?.devices ?? [];
	if (list.some((d) => d.uid === want)) return want;
	const low = want.toLowerCase();
	return list.find((d) => d.uid.toLowerCase() === low)?.uid ?? want;
}

/** 单台设备的班级 id（查不到返回 null —— 调用方按「确定不了就不放行」处理）。 */
export async function classOfDevice(uid: string): Promise<string | null> {
	const m = await fetchDeviceClassMap();
	if (!m) return null;
	return m.uidToClass.get(uid.toLowerCase()) ?? null;
}
