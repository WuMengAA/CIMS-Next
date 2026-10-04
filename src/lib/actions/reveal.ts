// 分段式出场动画：元素进入视口时以「blur 溶解 + 上浮微缩 + 展式缓出」柔和浮现，
// 按 --reveal-delay 错峰（70ms 步进），制造连绵的丝滑入场。
// 关键升级：IntersectionObserver 滚动触发 —— 长页面滚到哪、哪一段才浮现，
// 不再「进视口前就提前播完」，整页动效连贯不断档。
// 用法：<div use:reveal class="reveal" style="--reveal-delay:1">
import type { Action } from "svelte/action";
import { replaySplits } from "./split-reveal.js";

const STAGGER_MS = 70; // 错峰步进（与 CSS --reveal-delay 步进一致）

function applyDelay(node: HTMLElement, delay: number) {
	node.style.setProperty("--reveal-delay", String(delay));
}

export const reveal: Action<HTMLElement, { delay?: number } | undefined> = (node, opts = {}) => {
	// 优先参数 > data-reveal-delay 属性 > 内联 style --reveal-delay
	const inlineDelay = node.style.getPropertyValue("--reveal-delay");
	const delay = opts.delay ?? Number(node.dataset.revealDelay ?? (inlineDelay || 0));
	applyDelay(node, delay);

	// 减少动态效果 / 无脚本：直接落到终态
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
		node.classList.add("revealed");
		return { destroy() {} };
	}

	// IntersectionObserver：进入视口才触发；首屏元素会在下一帧立即触发（配合错峰步进形成入场编排）
	const io = new IntersectionObserver(
		(entries) => {
			for (const e of entries) {
				if (e.isIntersecting) {
					(e.target as HTMLElement).classList.add("revealed");
					io.disconnect();
				}
			}
		},
		{ threshold: 0.12, rootMargin: "0px 0px -6% 0px" }
	);
	io.observe(node);
	return { destroy() { io.disconnect(); } };
};

// 供全局控制器调用：导航后重放（移除 revealed → 强制重排 → 按步进加回）
export function replayReveals(root: HTMLElement | Document = document) {
	replaySplits(root);
	const nodes = root.querySelectorAll<HTMLElement>(".reveal");
	nodes.forEach((n) => {
		n.classList.remove("revealed");
		n.style.animation = "none";
		void n.offsetWidth;
		n.style.animation = "";
	});
	requestAnimationFrame(() => {
		nodes.forEach((n, i) => {
			setTimeout(() => n.classList.add("revealed"), i * STAGGER_MS);
		});
	});
}
