// 字符级遮罩揭开：把纯文本拆成逐字 span，每字用 clip-path 从上向下揭开 + 上浮微缩，
// 按 step 毫秒错峰，形成「一字一字浮出」的戏剧入场。
// 用法：<h1 use:splitReveal class="ef-split">Stelarith</h1>
import type { Action } from "svelte/action";

export const splitReveal: Action<HTMLElement, { step?: number; start?: number } | undefined> = (node, opts = {}) => {
	const step = opts.step ?? 42;
	const start = opts.start ?? 0;

	// 减少动态效果：保持原文直接可见
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return { destroy() {} };

	const raw = node.textContent || "";
	node.textContent = "";
	let i = 0;
	for (const ch of raw) {
		const sp2 = document.createElement("span");
		sp2.textContent = ch === " " ? "\u00A0" : ch;
		const d = start + i * step;
		sp2.style.transitionDelay = `${d}ms, ${d}ms, ${d}ms`;
		node.appendChild(sp2);
		i++;
	}
	node.classList.add("ef-split");

	let raf = 0;
	raf = requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add("play")));
	return {
		destroy() {
			cancelAnimationFrame(raf);
			node.classList.remove("play");
		},
	};
};

// 供导航重放调用：移除 play → 强制重排 → 重新播放
export function replaySplits(root: HTMLElement | Document = document) {
	root.querySelectorAll<HTMLElement>(".ef-split").forEach((n) => {
		n.classList.remove("play");
		void n.offsetWidth;
	});
	requestAnimationFrame(() => {
		root.querySelectorAll<HTMLElement>(".ef-split").forEach((n) => n.classList.add("play"));
	});
}
