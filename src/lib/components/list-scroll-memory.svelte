<script lang="ts">
	/**
	 * 列表页滚动位置记忆 —— 挂在列表页（/posts、/docs、/pages…）。
	 *
	 * 场景：用户在长列表里翻到第 5 屏点进某篇文章，返回列表时又回到顶部，
	 * 必须重新翻一遍 —— 这是内容型站点最常见的体验损耗。
	 *
	 * 实现要点：
	 *  - 恢复必须等**内容渲染完成**，否则列表还没高就恢复，等于没恢复。
	 *    这里在 onMount 后等两帧 + 一次 requestAnimationFrame，
	 *    并在恢复后立即停止"记录"，避免恢复动作本身被当成用户滚动写回去。
	 *  - 客户端返回（popstate）与直接导航都要适用，所以不依赖 afterNavigate。
	 */
	import { onMount } from "svelte";
	import { page } from "$app/state";
	import { getListScroll, saveListScrollThrottled } from "$lib/reading-progress.js";

	/** 需要记忆的路径前缀。默认覆盖所有内容列表页。 */
	let {
		prefixes = ["/posts", "/docs", "/pages", "/projects", "/search", "/archive", "/archives"]
	}: { prefixes?: string[] } = $props();

	// 只在匹配前缀的路径上工作
	const active = $derived(prefixes.some((p) => page.url.pathname === p || page.url.pathname.startsWith(p + "/")));
	const path = $derived(page.url.pathname);

	onMount(() => {
		if (!active) return;

		let restoring = true;
		const saved = getListScroll(path);

		if (saved > 80) {
			// 等布局稳定：两帧之后高度基本就位（图片/none 骨架已完成首屏布局）
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
					window.scrollTo({ top: saved, behavior: reduce ? "auto" : "auto" });
					// 再等一帧才允许记录，确保 scrollTo 触发的 scroll 事件被忽略
					requestAnimationFrame(() => { restoring = false; });
				});
			});
		} else {
			restoring = false;
		}

		const onScroll = () => {
			if (restoring) return;
			saveListScrollThrottled(path, window.scrollY);
		};
		window.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			window.removeEventListener("scroll", onScroll);
			// 卸载时补最后一次
			if (!restoring) saveListScrollThrottled(path, window.scrollY);
		};
	});
</script>

<!-- 纯行为组件：不渲染任何可见内容 -->
