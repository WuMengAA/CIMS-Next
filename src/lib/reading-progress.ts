import { readPref, writePref, throttled } from "./prefs.js";

/**
 * 阅读进度与浏览历史。
 *
 * 目标（对应"一站式浏览 / 界面存储缓存记忆 / 文章浏览进度保存"）：
 *  - 每篇内容的阅读进度按 target 存下来，回到页面时自动续读；
 *  - 维护一份「最近浏览」，供首页/侧栏的「继续阅读」入口使用；
 *  - 全部本地存储，不上传 —— 阅读轨迹属隐私，没有理由离开设备。
 *
 * 键空间约定：target 用 `"<section>:<slug>"`（如 `posts:hello-world`），
 * 与 ViewTracker / Comments 的 target 口径一致，避免一套内容两个 id。
 */

export interface ReadingRecord {
	/** 内容标识，如 posts:hello-world */
	target: string;
	/** 标题（用于「继续阅读」展示；存快照，不依赖再次请求） */
	title: string;
	/** 前台链接 */
	href: string;
	/** 进度 0..1 */
	progress: number;
	/** 最后阅读时间戳（ms） */
	at: number;
	/** 分组（posts / docs / pages …），便于按类型过滤 */
	section: string;
}

const MAX_HISTORY = 30;

/** 读取全部阅读记录（按时间倒序）。 */
export function getReadingRecords(): ReadingRecord[] {
	const list = readPref<ReadingRecord[]>("reading:last", []);
	return Array.isArray(list) ? list.filter((r) => r && r.target && r.href) : [];
}

/** 取某篇的进度 0..1。 */
export function getProgress(target: string): number {
	const map = readPref<Record<string, number>>("reading:progress", {});
	const v = map[target];
	return typeof v === "number" && v > 0 && v < 1 ? v : 0;
}

/**
 * 写入某篇的进度与历史。
 * 进度接近 0 视为"刚打开"，接近 1 视为"读完了" —— 两种都不该在
 * 「继续阅读」里出现（前者没意义，后者已完成），因此把记录标记完读后移除。
 */
export function saveReading(input: { target: string; title: string; href: string; progress: number; section?: string }) {
	const { target, title, href } = input;
	const progress = Math.max(0, Math.min(1, input.progress || 0));
	const section = input.section || target.split(":")[0] || "";

	// 进度表：低于 3% 不记（刚打开），高于 97% 记为已完成（值 1，供个别场景判断）
	const map = readPref<Record<string, number>>("reading:progress", {});
	if (progress < 0.03) {
		delete map[target];
	} else {
		map[target] = progress >= 0.97 ? 1 : progress;
	}
	writePref("reading:progress", map);

	// 历史表：进度太小的不写，其余置顶
	if (progress < 0.03) return;
	const list = getReadingRecords().filter((r) => r.target !== target);
	list.unshift({ target, title, href, progress, at: Date.now(), section });
	writePref("reading:last", list.slice(0, MAX_HISTORY));
}

/** 节流版保存：给 scroll 事件用，避免高频同步写拖累滚动。 */
export const saveReadingThrottled = throttled(saveReading, 500);

/**
 * 「继续阅读」候选：未读完（进度 < 97%）的最近若干条。
 * 已读完整的会从候选中排除 —— 给用户看"已经读完的"没有价值。
 */
export function getContinueReading(limit = 3, section?: string): ReadingRecord[] {
	return getReadingRecords()
		.filter((r) => r.progress > 0.03 && r.progress < 0.97)
		.filter((r) => (section ? r.section === section : true))
		.slice(0, limit);
}

/** 清空阅读轨迹（隐私入口：账号页/设置页可提供"清除本地阅读记录"）。 */
export function clearReading() {
	writePref("reading:progress", {});
	writePref("reading:last", []);
}

/* ── 列表滚动位置 ─────────────────────────────────────────────────────── */

/** 记录某列表路径的滚动位置（返回后恢复）。 */
export function saveListScroll(path: string, y: number) {
	if (y < 80) {
		// 顶部附近的滚动没有恢复价值，反而会让"点了链接回来还停在半路"变怪
		const map = readPref<Record<string, number>>("list:scroll", {});
		delete map[path];
		writePref("list:scroll", map);
		return;
	}
	const map = readPref<Record<string, number>>("list:scroll", {});
	map[path] = Math.round(y);
	writePref("list:scroll", map);
}

export const saveListScrollThrottled = throttled(saveListScroll, 400);

export function getListScroll(path: string): number {
	const map = readPref<Record<string, number>>("list:scroll", {});
	return map[path] || 0;
}

/* ── 浏览轨迹（供「最近浏览」面板） ────────────────────────────────────── */

/** 记录一次页面访问（标题 + 路径）。同路径短时间内重复访问只留最新一条。 */
export function recordVisit(path: string, title: string) {
	if (!path || path.startsWith("/admin") || path.startsWith("/api")) return;
	const list = readPref<{ path: string; title: string; at: number }[]>("browse:visit", []);
	const rest = list.filter((v) => v.path !== path);
	rest.unshift({ path, title: title || path, at: Date.now() });
	writePref("browse:visit", rest.slice(0, MAX_HISTORY));
}

export function getVisits(limit = 10) {
	return readPref<{ path: string; title: string; at: number }[]>("browse:visit", []).slice(0, limit);
}

/** 从浏览轨迹里移除一条（用户主动清理，尊重"这是我的记录"的掌控感）。 */
export function removeVisit(path: string) {
	const rest = readPref<{ path: string; title: string; at: number }[]>("browse:visit", [])
		.filter((v) => v.path !== path);
	writePref("browse:visit", rest);
}

/** 清空浏览轨迹。 */
export function clearVisits() {
	writePref("browse:visit", []);
}
