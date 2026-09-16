/**
 * 侧边栏宽度（可推拉）—— 全局共享状态。
 *
 * 桌面侧边栏的宽度由 CSS 变量 --sidebar-width 控制（Sidebar.Provider 注入），
 * 内容区（Sidebar.Inset / gap 元素）随该变量自动伸缩，因此只需要把宽度变成
 * 一个可拖拽调整的响应式值，页面宽度自适应就天然成立。
 *
 * 宽度以 px 存储，范围 [MIN, MAX]；折叠为图标列时不参与（宽度固定为
 * --sidebar-width-icon，3rem）。持久化到 localStorage，跨会话恢复。
 *
 * 注意：Svelte 5 runes 不允许「导出 state 后又整体重赋值」，因此这里
 * 不导出 state 本身，而是导出 getter 函数（模板表达式调用函数时会建立
 * 响应式依赖），setter 在模块内部完成重赋值。
 */
import { browser } from "$app/environment";

const STORAGE_KEY = "acofork_sidebar_width";
const DEFAULT_WIDTH = 256; // 对应组件默认 16rem
export const SIDEBAR_WIDTH_MIN = 224;
export const SIDEBAR_WIDTH_MAX = 420;

function clamp(v: number): number {
	return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(v)));
}

let sidebarWidthPx = $state(DEFAULT_WIDTH);

if (browser) {
	try {
		const v = parseInt(localStorage.getItem(STORAGE_KEY) || "", 10);
		if (Number.isFinite(v)) sidebarWidthPx = clamp(v);
	} catch {
		/* 隐私模式等场景忽略 */
	}
}

/** 读取当前宽度（响应式：模板中调用会自动追踪变化）。 */
export function getSidebarWidthPx(): number {
	return sidebarWidthPx;
}

/** 设置宽度并持久化；超出范围自动收敛。 */
export function setSidebarWidth(px: number): void {
	sidebarWidthPx = clamp(px);
	try {
		localStorage.setItem(STORAGE_KEY, String(sidebarWidthPx));
	} catch {
		/* ignore */
	}
}
