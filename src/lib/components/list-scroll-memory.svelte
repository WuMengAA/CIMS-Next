<script lang="ts">
	/**
	 * 列表页滚动位置记忆 —— 挂在根布局（对 /posts、/docs、/pages… 生效）。
	 *
	 * 场景：用户在长列表里翻到第 5 屏点进某篇文章，返回列表时又回到顶部，
	 * 必须重新翻一遍 —— 这是内容型站点最常见的体验损耗。
	 *
	 * 为什么用 $effect 而不是 onMount：这是根布局常驻组件，SPA 客户端导航
	 * 到不同列表页时组件不会重新挂载，onMount 只在首屏执行一次——后续切换
	 * 到 /posts、/search 等列表页时「恢复滚动」逻辑根本不会跑，表现为
	 * "侧边栏切换 / 页面不刷新时滑动进度丢失"。
	 * 这里把恢复与监听都写进 $effect，路径变化即重新执行：每个列表页
	 * 进入时恢复上次滚动，离开时记录当前位置。
	 */
	import { page } from "$app/state";
	import { getListScroll, saveListScrollThrottled } from "$lib/reading-progress.js";

	/** 需要记忆的路径前缀。默认覆盖所有内容列表页。 */
	let {
		prefixes = ["/posts", "/docs", "/pages", "/projects", "/search", "/archive", "/archives"]
	}: { prefixes?: string[] } = $props();

	$effect(() => {
		const path = page.url.pathname;
		const active = prefixes.some((p) => path === p || path.startsWith(p + "/"));
		if (!active) return;

		let restoring = true;
		const saved = getListScroll(path);

		if (saved > 80) {
			// 等布局稳定：两帧之后高度基本就位（图片/none 骨架已完成首屏布局）
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					window.scrollTo({ top: saved, behavior: "auto" });
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