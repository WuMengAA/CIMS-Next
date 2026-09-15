<script lang="ts">
	/**
	 * 浏览轨迹记录 —— 挂在根布局，客户端导航时记下「路径 + 标题」。
	 *
	 * 为什么用 afterNavigate 而不是每个页面自己调：
	 * 轨迹要覆盖全部前台页面（包括没有专门组件的列表页、归档页），
	 * 挂在根布局一处即可。且 afterNavigate 能拿到导航后的 document.title，
	 * 无需每个页面传入标题。
	 *
	 * 过滤在后端（reading-progress.recordVisit）内做：/admin、/api 不入轨迹。
	 */
	import { afterNavigate } from "$app/navigation";
	import { recordVisit } from "$lib/reading-progress.js";

	afterNavigate(() => {
		// 等一拍：document.title 由 <svelte:head> 在导航后被 SvelteKit 写入，
		// 立刻读取会拿到上一个页面的标题。
		setTimeout(() => {
			try {
				recordVisit(location.pathname, document.title.split("|")[0].trim());
			} catch { /* noop */ }
		}, 80);
	});
</script>

<!-- 纯行为组件：不渲染可见内容 -->
