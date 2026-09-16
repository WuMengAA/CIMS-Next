<script lang="ts">
	/**
	 * 侧边栏滚动位置记忆 —— 前台/后台共用同一份存储键。
	 *
	 * 为什么"前后台同步"很重要：侧边栏在两处是不同组件（AppSidebar / admin 布局），
	 * 但用户心里只有一个侧边栏。若各存各的键，用户从后台回到前台会发现
	 * 滚动位置"重置了"，像是两套界面。
	 *
	 * 为什么用 $effect 而不是 onMount：前台/后台的侧栏容器是**两个不同 DOM 节点**
	 * （AppSidebar 的 [data-slot="sidebar-content"] 与 admin 布局的同名节点）。
	 * SPA 切换时旧节点销毁、新节点挂载，onMount 只跑一次绑定的还是旧节点——表现为
	 * "侧边栏切换后滑动进度丢失"。这里把它改成响应式：每次路径变化（页面不刷新）
	 * 后重新寻找当前可见的滚动容器并绑定监听，切换前后台时滚动位置自动延续。
	 */
	import { page } from "$app/state";
	import { readPref, writePref } from "$lib/prefs.js";
	import { SIDEBAR_SCROLL_KEY } from "$lib/sidebar-memory.js";

	$effect(() => {
		// 显式读取，建立对路径的依赖：导航（含前后台切换）即触发重新绑定。
		page.url.pathname;
		let el: HTMLElement | null = null;
		let restoring = true;
		let bound = false;
		let timer: ReturnType<typeof setTimeout> | undefined;

		/** 找当前可见的侧栏滚动容器（桌面常驻列 / 移动抽屉各一份，取有高度的）。 */
		function scroller(): HTMLElement | null {
			const nodes = document.querySelectorAll<HTMLElement>('[data-slot="sidebar-content"]');
			for (const n of Array.from(nodes)) {
				if (n.offsetHeight > 0) return n;
			}
			return nodes[0] ?? null;
		}

		const onScroll = () => {
			if (!el || restoring) return;
			const target = el;
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				writePref(SIDEBAR_SCROLL_KEY, Math.round(target.scrollTop));
			}, 300);
		};

		// 导航完成、新容器挂载后 DOM 才齐全，用微任务 + 双 rAF 保障。
		(async () => {
			await Promise.resolve();
			el = scroller();
			if (!el) return;

			// 恢复：等布局稳定后写回
			const saved = readPref<number>(SIDEBAR_SCROLL_KEY, 0) || 0;
			if (saved > 10) {
				requestAnimationFrame(() => {
					requestAnimationFrame(() => {
						if (!el) return;
						el.scrollTop = saved;
						requestAnimationFrame(() => { restoring = false; });
					});
				});
			} else {
				restoring = false;
			}

			el.addEventListener("scroll", onScroll, { passive: true });
			bound = true;
		})();

		return () => {
			if (timer) clearTimeout(timer);
			if (el && bound) {
				el.removeEventListener("scroll", onScroll);
				if (!restoring) writePref(SIDEBAR_SCROLL_KEY, Math.round(el.scrollTop));
			}
			el = null;
			bound = false;
		};
	});
</script>

<!-- 纯行为组件：不渲染任何可见内容 -->