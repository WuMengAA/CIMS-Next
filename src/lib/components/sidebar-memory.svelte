<script lang="ts">
	/**
	 * 侧边栏滚动位置记忆 —— 前台/后台共用同一份存储键。
	 *
	 * 为什么"前后台同步"很重要：侧边栏在两处是不同组件（AppSidebar / admin 布局），
	 * 但用户心里只有一个侧边栏。若各存各的键，用户从后台回到前台会发现
	 * 滚动位置"重置了"，像是两套界面。
	 *
	 * 实现：挂在 Provider 内部，对实际侧栏滚动容器
	 * （[data-slot="sidebar-content"]）做记忆。移动端抽屉本身就短、
	 * 且每次导航自动关闭，无需记忆 —— 因此只处理有高度的那个容器。
	 */
	import { onMount } from "svelte";
	import { readPref, writePref, throttled } from "$lib/prefs.js";
	import { SIDEBAR_SCROLL_KEY } from "$lib/sidebar-memory.js";

	onMount(() => {
		let restoring = true;

		/** 找当前可见的侧栏滚动容器（桌面常驻列 / 移动抽屉各一份，取有高度的）。 */
		function scroller(): HTMLElement | null {
			const nodes = document.querySelectorAll<HTMLElement>('[data-slot="sidebar-content"]');
			for (const n of Array.from(nodes)) {
				if (n.offsetHeight > 0) return n;
			}
			return nodes[0] ?? null;
		}

		const el = scroller();
		if (!el) return;

		// 恢复：等布局稳定后写回
		const saved = readPref<number>(SIDEBAR_SCROLL_KEY, 0) || 0;
		if (saved > 10) {
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					el.scrollTop = saved;
					requestAnimationFrame(() => { restoring = false; });
				});
			});
		} else {
			restoring = false;
		}

		const onScroll = throttled(() => {
			if (restoring) return;
			writePref(SIDEBAR_SCROLL_KEY, Math.round(el.scrollTop));
		}, 300);

		el.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			el.removeEventListener("scroll", onScroll);
			if (!restoring) writePref(SIDEBAR_SCROLL_KEY, Math.round(el.scrollTop));
		};
	});
</script>

<!-- 纯行为组件：不渲染可见内容 -->
