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
