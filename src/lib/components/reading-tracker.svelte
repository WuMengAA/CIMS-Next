<script lang="ts">
	/**
	 * 阅读进度跟踪器 —— 挂在内容详情页（文章/教程/页面）。
	 *
	 * 做三件事：
	 *  1. 滚动时按节流记录进度（0..1）与该文的标题/链接，供「继续阅读」使用；
	 *  2. 首次进入时若存在历史进度，弹出「上次读到 42%，继续阅读？」的续读条；
	 *  3. 记录浏览轨迹（标题快照），供「最近浏览」面板。
	 *
	 * 为什么进度要用「滚动比例」而非「锚点序号」：正文高度随图片懒加载、
	 * 字号偏好、窗口宽度都在变，锚点序号在跨设备/跨窗口尺寸时不稳；
	 * 滚动比例虽然有 ±1 屏误差，但换来的是任何环境下都能用。
	 */
	import { onMount } from "svelte";
	import { page } from "$app/state";
	import { X, Bookmark } from "@lucide/svelte";
	import {
		getProgress, saveReading, saveReadingThrottled, recordVisit
	} from "$lib/reading-progress.js";

	let {
		/** 内容标识，如 "posts:hello-world"（与 ViewTracker 同口径） */
		target,
		/** 标题，用于「继续阅读」条目 */
		title = "",
		/** 分组，默认从 target 的前缀推断 */
		section = ""
	}: { target: string; title?: string; section?: string } = $props();

	// 续读提示：仅在存在有效历史进度且用户尚未滚动时显示
	let resumePct = $state(0);
	let dismissed = $state(false);

	const href = $derived(page.url.pathname);

	function currentProgress(): number {
		const doc = document.documentElement;
		const max = doc.scrollHeight - doc.clientHeight;
		return max > 0 ? Math.min(1, window.scrollY / max) : 0;
	}

	function persist() {
		// title 变化（如从 <title> 前缀拿到的）也要跟着更新，因此每次读实时值
		saveReadingThrottled({
			target,
			title: title || document.title.split("|")[0].trim(),
			href,
			progress: currentProgress(),
			section: section || target.split(":")[0]
		});
	}

	function resume() {
		const doc = document.documentElement;
		const max = doc.scrollHeight - doc.clientHeight;
		const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		window.scrollTo({ top: max * resumePct, behavior: reduce ? "auto" : "smooth" });
		dismissed = true;
	}

	onMount(() => {
		// 已有进度 → 展示续读条。阈值 5% 以下不值得提示（几乎等于从头读）。
		const saved = getProgress(target);
		if (saved >= 0.05 && saved < 0.97 && window.scrollY < 200) {
			resumePct = saved;
		}

		// 浏览轨迹：客户端导航也算（afterNavigate 无法在此组件内直接用，
		// 这里用 target 变化即可 —— 组件随页面重建，onMount 已足够）
		recordVisit(href, title || document.title.split("|")[0].trim());

		const onScroll = () => {
			persist();
			// 一旦用户自己开始滚动，续读条就该消失（用户已经"接管"了位置）
			if (resumePct && window.scrollY > 260) dismissed = true;
		};
		window.addEventListener("scroll", onScroll, { passive: true });
		// 离开页面（含关闭标签）时补一次，避免最后一次滚动丢失
		const onLeave = () => saveReading({
			target,
			title: title || document.title.split("|")[0].trim(),
			href,
			progress: currentProgress(),
			section: section || target.split(":")[0]
		});
		window.addEventListener("pagehide", onLeave);
		document.addEventListener("visibilitychange", onLeave);

		return () => {
			window.removeEventListener("scroll", onScroll);
			window.removeEventListener("pagehide", onLeave);
			document.removeEventListener("visibilitychange", onLeave);
			persist();
		};
	});
</script>

{#if resumePct && !dismissed}
	<!-- 续读条：右下角浮出，不遮挡正文；可一键续读或关闭 -->
	<div
		class="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border/60 bg-card px-4 py-2 shadow-lg backdrop-blur-sm transition-all duration-300 md:left-6 md:translate-x-0 motion-reduce:transition-none"
		role="status"
	>
		<Bookmark class="size-3.5 shrink-0 text-primary" />
		<span class="whitespace-nowrap text-xs text-muted-foreground">
			上次读到 <span class="font-medium text-foreground">{Math.round(resumePct * 100)}%</span>
		</span>
		<button
			class="whitespace-nowrap rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
			onclick={resume}
		>继续阅读</button>
		<button
			class="text-muted-foreground transition-colors hover:text-foreground"
			onclick={() => (dismissed = true)}
			aria-label="关闭续读提示"
		><X class="size-3.5" /></button>
	</div>
{/if}
