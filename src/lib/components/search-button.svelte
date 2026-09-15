<script lang="ts">
	/**
	 * 顶栏搜索按钮 —— 唤起搜索面板（不跳页），并展示快捷键提示。
	 *
	 * 为什么是"按钮 + 面板"而不是直接一个链接到 /search：
	 * 顶栏右上角是最容易形成肌肉记忆的位置，点一下就出输入框、就地搜、
	 * 选中即跳——整个过程不离开当前页面。完整搜索页仍保留，作为"看全部结果"的出口。
	 *
	 * 快捷键提示在宽屏显示（Mac 显示 ⌘K，其它显示 Ctrl K），窄屏隐藏以免挤占空间。
	 */
	import { Search } from "@lucide/svelte";
	import { onMount } from "svelte";

	let { open = $bindable(false) }: { open?: boolean } = $props();

	// 平台判定只能在客户端做（SSR 阶段没有 navigator）
	let isMac = $state(false);
	onMount(() => {
		isMac = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
	});
</script>

<button
	class="group flex h-8 items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-2 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground md:pr-1.5"
	onclick={() => (open = true)}
	aria-label="搜索（快捷键 {isMac ? '⌘' : 'Ctrl'}+K）"
	title="搜索 · {isMac ? '⌘K' : 'Ctrl+K'}"
>
	<Search class="size-4 shrink-0" />
	<!-- 宽屏显示占位文案，让按钮本身像输入框（可预期的点击目标） -->
	<span class="hidden text-xs lg:inline">搜索…</span>
	<kbd class="ml-1 hidden items-center gap-0.5 rounded border border-border/60 bg-background px-1.5 py-0.5 font-sans text-[10px] font-medium lg:flex">
		{#if isMac}<span>⌘</span>{:else}<span>Ctrl</span>{/if}
		<span>K</span>
	</kbd>
</button>
