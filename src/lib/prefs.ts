/**
 * 客户端偏好持久化 —— 统一的 localStorage 读写与 cookie 治理。
 *
 * 为什么要有这一层，而不是各处直接调 localStorage / document.cookie：
 *
 * 1. **cookie 治理**：原先侧边栏折叠态是裸写
 *    `document.cookie = "sidebar_state=...; path=/"` —— 缺 SameSite、缺 Secure
 *    判断，且分散在多处。这里统一出口，默认带 `SameSite=Lax`，
 *    并对 http/https 决定是否加 Secure（本地 http 开发加 Secure 会直接失效）。
 *
 * 2. **键命名集中**：所有键以 `stelarith:` 前缀命名空间化，避免与第三方脚本
 *    （浏览器插件、统计、演示态脚本）在同源下撞名 —— 撞名的典型后果是
 *    "我的侧栏折叠状态偶尔被别的东西改掉"，极难排查。
 *
 * 3. **SSR 安全**：`typeof window` 守卫集中在这里，调用方不必到处判断。
 *    localStorage 在 SvelteKit 的 SSR 阶段不存在，漏判会 500。
 *
 * 4. **失败降级**：隐私模式 / 存储配额满时 localStorage 会抛异常。
 *    这里全部 try/catch 吞掉并返回默认值 —— 偏好存不上不该让页面崩。
 */

const NS = "stelarith:";

export type PrefKey =
	| "sidebar:scroll"        // 侧边栏滚动位置（px）
	| "sidebar:open"          // 桌面侧边栏折叠态（cookie 的镜像，供同步读）
	| "reading:progress"      // 每篇文章的阅读进度 { [target]: 0..1 }
	| "reading:last"          // 最近阅读记录 [{ target, title, href, at }]
	| "list:scroll"           // 列表页滚动位置 { [path]: px }
	| "nav:expanded"          // 「更多」等折叠分组的展开态
	| "browse:visit"          // 访问轨迹（标题 + 路径 + 时间）
	| "dismissed:ann"         // 已关闭的公告 id 列表（沿用旧键名见下）
	| "editor:needRefresh"    // 编辑器保存后提示后台列表刷新
	| "ui:lastTab"            // 各页上次停留的标签页
	| "page:devicePreview";   // 页面编辑器上次选的预览设备

/** 旧键名 -> 新键名。读取时先看新键，没有则回落到旧键并自动迁移。 */
const LEGACY: Record<string, string> = {
	"dismissed_ann": "stelarith:dismissed:ann",
	"acofork_need_refresh": "stelarith:editor:needRefresh"
};

function fullKey(key: PrefKey | string): string {
	// 允许调用方传已带前缀的完整键（旧代码迁移期）
	return key.startsWith(NS) ? key : NS + key;
}

/* ── localStorage ───────────────────────────────────────────────────────── */

export function readPref<T>(key: PrefKey | string, fallback: T): T {
	if (typeof window === "undefined") return fallback;
	const k = fullKey(key);
	try {
		let raw = window.localStorage.getItem(k);
		// 迁移旧键：新键不存在时，从旧键读一次并写入新键（只做一次）。
		if (raw === null) {
			const legacy = LEGACY[k.replace(NS, "")] ?? LEGACY[k];
			if (legacy) {
				raw = window.localStorage.getItem(legacy);
				if (raw !== null) {
					window.localStorage.setItem(k, raw);
					window.localStorage.removeItem(legacy);
				}
			}
		}
		if (raw === null) return fallback;
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

export function writePref(key: PrefKey | string, value: unknown): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(fullKey(key), JSON.stringify(value));
	} catch {
		/* 隐私模式 / 配额满：静默降级，偏好存不上不影响使用 */
	}
}

export function removePref(key: PrefKey | string): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.removeItem(fullKey(key));
	} catch { /* noop */ }
}

/* ── cookie（供需要在 SSR 阶段读到的偏好使用） ───────────────────────────── */

export interface CookieOptions {
	/** 有效期（秒）。默认 1 年。 */
	maxAge?: number;
	path?: string;
	/** 默认 'Lax'：兼顾 CSRF 防护与站内跳转可用性。 */
	sameSite?: "Lax" | "Strict" | "None";
	/**
	 * 是否加 Secure。默认自动判断：https 页面才加 ——
	 * 本地 http 开发时加 Secure 会让 cookie 完全写不进去（浏览器直接丢弃），
	 * 这是"本地能跑线上不行 / 反过来"的经典坑。
	 */
	secure?: boolean;
}

export function setCookie(name: string, value: string, opts: CookieOptions = {}): void {
	if (typeof document === "undefined") return;
	const {
		maxAge = 60 * 60 * 24 * 365,
		path = "/",
		sameSite = "Lax",
		secure = window.location.protocol === "https:"
	} = opts;
	let c = `${name}=${encodeURIComponent(value)}; path=${path}; max-age=${maxAge}; samesite=${sameSite}`;
	if (secure) c += "; secure";
	document.cookie = c;
}

export function getCookie(name: string): string | null {
	if (typeof document === "undefined") return null;
	const m = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^;]*)"));
	return m ? decodeURIComponent(m[1]) : null;
}

/* ── 节流写入：滚动这类高频事件用 ──────────────────────────────────────── */

/**
 * 返回一个"最多每 wait 毫秒写一次"的函数。
 * 滚动位置若每次都写 localStorage，一次滚动能触发上百次同步写，
 * 会明显拖累滚动帧率（localStorage 是同步阻塞 API）。
 */
export function throttled<T extends (...args: any[]) => void>(fn: T, wait = 400): T {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let last = 0;
	return function (this: any, ...args: any[]) {
		const now = Date.now();
		const remain = wait - (now - last);
		if (remain <= 0) {
			last = now;
			fn.apply(this, args);
		} else if (!timer) {
			timer = setTimeout(() => {
				timer = undefined;
				last = Date.now();
				fn.apply(this, args);
			}, remain);
		}
	} as unknown as T;
}
