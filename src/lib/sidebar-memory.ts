/**
 * 侧边栏界面记忆 —— 前后台共用的持久化读写。
 *
 * 与 sidebar-memory.svelte（负责滚动位置的行为组件）分开成独立模块，
 * 是因为 app-sidebar.svelte 需要在**组件初始化阶段**就读出「更多」分组的展开态
 * （作为 moreOpen 的初始值）。若把这些函数放在 .svelte 的 <script module> 里，
 * 虽然也能 import，但会让"行为组件"与"纯函数工具"混在一个文件，
 * 且导入 .svelte 只为拿函数会连带触发组件编译，语义与开销都不对。
 */
import { readPref, writePref } from "./prefs.js";

/** 侧栏滚动位置的键。前后台共用同一份 —— 用户心里只有一个侧边栏。 */
export const SIDEBAR_SCROLL_KEY = "sidebar:scroll";

/** 「更多」等折叠分组的展开态。 */
export function readMoreOpen(): boolean {
	return readPref<boolean>("nav:expanded", false);
}

export function writeMoreOpen(v: boolean): void {
	writePref("nav:expanded", v);
}

/** 「校园」等折叠分组的展开态（工作区侧边栏）。 */
export function readCampusOpen(): boolean {
	return readPref<boolean>("nav:campus-expanded", false);
}

export function writeCampusOpen(v: boolean): void {
	writePref("nav:campus-expanded", v);
}

/**
 * 自定义分组（镜像站等）的展开态 —— 按 group key 各记一份。
 *
 * 为什么存成「一个对象」而不是每个组一个键：组的增删是后台随时可做的动作，
 * 若按组名展开成独立 localStorage 键，删组后旧键会永远留在用户浏览器里；
 * 存成一个 map 则在组消失后，后续写入自然把它覆盖掉，无需清理逻辑。
 */
const GROUP_OPEN_KEY = "nav:groups";

function readGroupMap(): Record<string, boolean> {
	const raw = readPref<unknown>(GROUP_OPEN_KEY, {});
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
	return raw as Record<string, boolean>;
}

export function readGroupOpen(key: string, fallback = false): boolean {
	const map = readGroupMap();
	return typeof map[key] === "boolean" ? map[key] : fallback;
}

export function writeGroupOpen(key: string, v: boolean): void {
	const map = readGroupMap();
	map[key] = v;
	writePref(GROUP_OPEN_KEY, map);
}
