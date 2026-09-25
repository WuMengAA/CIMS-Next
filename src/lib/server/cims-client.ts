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
		fetch(`${MGMT}${path}`, {
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

let mapCache: { at: number; uidToClass: Map<string, string>; classes: { class_id: string; name: string }[] } | null =
	null;

/**
 * uid → class_id 映射（键小写归一；CIMS 的 client_id 与 agent host 大小写不一，
 * 与 captures 双 key 的教训一致 —— 查询侧统一 toLowerCase）。
 */
export async function fetchDeviceClassMap(): Promise<{
	uidToClass: Map<string, string>;
	classes: { class_id: string; name: string }[];
} | null> {
	if (mapCache && Date.now() - mapCache.at < CACHE_MS) return mapCache;
	const data = await cimsGet<{ devices?: Record<string, unknown>; classes?: unknown }>("/class/device-map");
	if (!data || typeof data !== "object") return null;
	const uidToClass = new Map<string, string>();
	const devices = data.devices && typeof data.devices === "object" ? data.devices : {};
	for (const [uid, info] of Object.entries(devices)) {
		const cid =
			typeof info === "string"
				? info
				: ((info as DeviceClassEntry)?.class_id as string | undefined) ?? "";
		if (cid) uidToClass.set(uid.toLowerCase(), cid);
	}
	const classes = Array.isArray(data.classes)
		? (data.classes as { class_id?: string; name?: string }[])
				.filter((c) => c && c.class_id)
				.map((c) => ({ class_id: String(c.class_id), name: String(c.name ?? c.class_id) }))
		: [];
	mapCache = { at: Date.now(), uidToClass, classes };
	return mapCache;
}

/** 单台设备的班级 id（查不到返回 null —— 调用方按「确定不了就不放行」处理）。 */
export async function classOfDevice(uid: string): Promise<string | null> {
	const m = await fetchDeviceClassMap();
	if (!m) return null;
	return m.uidToClass.get(uid.toLowerCase()) ?? null;
}
