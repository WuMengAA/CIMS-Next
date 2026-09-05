// 通用分段式加载动画：元素进入视口时以弹簧曲线依次浮现；导航/刷新后自动重放。
// 用法：<div use:reveal class="reveal" style="--delay:1"> 或 <div use:reveal data-reveal-delay="2">
// --delay 为分段序号（0 起步），元素按 --delay * 90ms 错峰入场；spring 阻尼曲线由 CSS 变量控制。
import type { Action } from "svelte/action";

export const reveal: Action<HTMLElement, { delay?: number }> = (node, opts = {}) => {
	const delay = opts.delay ?? Number(node.dataset.revealDelay ?? 0);
	const start = Date.now();
	let raf = 0;
	const unlock = () => {
		node.classList.add("revealed");
		node.style.setProperty("--reveal-delay", String(delay));
	};
	// 分段错峰：delay 0 立即，delay 1 等 90ms，依次类推
	const wait = delay * 80;
	raf = window.setTimeout(unlock, wait) as unknown as number;
	return {
		destroy() { clearTimeout(raf); }
	};
};

// 供全局控制器调用：重新触发（导航后）
export function replayReveals(root: HTMLElement | Document = document) {
	const nodes = root.querySelectorAll<HTMLElement>(".reveal");
	nodes.forEach((n, i) => {
		n.classList.remove("revealed");
		// 强制重启动画
		n.style.animation = "none";
		void n.offsetWidth;
		n.style.animation = "";
		n.style.setProperty("--reveal-delay", String(i));
	});
	requestAnimationFrame(() => {
		nodes.forEach((n, i) => {
			setTimeout(() => n.classList.add("revealed"), i * 80);
		});
	});
}