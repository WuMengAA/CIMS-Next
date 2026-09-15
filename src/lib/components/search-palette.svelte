<script lang="ts">
	/**
	 * 搜索面板 —— 顶栏右上角搜索按钮唤起的命令式搜索浮层。
	 *
	 * 为什么不直接跳 /search 页：
	 *  - 跳页会丢失当前阅读上下文（这是"一站式浏览"里最该避免的打断）；
	 *  - 快捷键唤起 + 就地输入筛选，是内容站点的效率基线。
	 * 保留"跳转完整搜索页"作为出口（回车/按钮），两种需求都满足。
	 *
	 * 交互：点按钮或按 / 或 Ctrl/Cmd+K 打开；Esc 关闭；↑↓ 选择，Enter 打开。
	 */
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { fade, fly } from "svelte/transition";
	import { Search, FileText, Rocket, BookMarked, CornerDownLeft, X, Loader2 } from "@lucide/svelte";
	import { throttled } from "$lib/prefs.js";

	let {
		open = $bindable(false)
	}: { open?: boolean } = $props();

	let q = $state("");
	let hits = $state<any[]>([]);
	let loading = $state(false);
	let cursor = $state(0);
	let inputEl: HTMLInputElement | undefined = $state(undefined);
	let reqSeq = 0;

	const ICONS: Record<string, any> = { posts: FileText, projects: Rocket, docs: BookMarked, pages: FileText };

	// 客户端收窄：输入即请求站内搜索 API，防抖 220ms
	const runSearch = throttled(async (term: string) => {
		const seq = ++reqSeq;
		if (!term.trim()) { hits = []; loading = false; return; }
		loading = true;
		try {
			const res = await fetch("/api/search?q=" + encodeURIComponent(term) + "&limit=8");
			if (seq !== reqSeq) return; // 后发先至的旧响应直接丢弃
			if (res.ok) {
				const data = await res.json();
				hits = data.hits ?? [];
				cursor = 0;
			}
		} catch { /* noop */ }
		if (seq === reqSeq) loading = false;
	}, 220);

	$effect(() => {
		const term = q;
		runSearch(term);
	});

	// 打开时聚焦输入；关闭时清空
	$effect(() => {
		if (open) {
			queueMicrotask(() => inputEl?.focus());
		} else {
			q = "";
			hits = [];
		}
	});

	function goFullSearch() {
		const term = q.trim();
		open = false;
		goto("/search" + (term ? "?q=" + encodeURIComponent(term) : ""));
	}

	function pick(hit: any) {
		open = false;
		goto(hit.href);
	}

	function onKey(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === "Escape") { e.preventDefault(); open = false; }
		else if (e.key === "ArrowDown") { e.preventDefault(); cursor = Math.min(cursor + 1, hits.length - 1); }
		else if (e.key === "ArrowUp") { e.preventDefault(); cursor = Math.max(cursor - 1, 0); }
		else if (e.key === "Enter") {
			e.preventDefault();
			if (hits[cursor]) pick(hits[cursor]);
			else goFullSearch();
		}
	}

	// 全局快捷键：Ctrl/Cmd+K 或单独按 / 打开（在输入框里按 / 应输入字符，故排除）
	function onGlobalKey(e: KeyboardEvent) {
		if (open) return;
		const tag = (e.target as HTMLElement)?.tagName;
		const typing = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable;
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
			e.preventDefault();
			open = true;
		} else if (e.key === "/" && !typing) {
			e.preventDefault();
			open = true;
		}
	}

	onMount(() => {
		document.addEventListener("keydown", onGlobalKey);
		return () => document.removeEventListener("keydown", onGlobalKey);
	});
</script>

<svelte:window onkeydown={onKey} />

{#if open}
	<!-- 遮罩：点击空白关闭 -->
	<div
		class="fixed inset-0 z-[70] bg-black/40 backdrop-blur-[2px]"
		onclick={() => (open = false)}
		role="presentation"
		transition:fade={{ duration: 120 }}
	></div>

	<!-- 面板：顶部居中，命令面板式 -->
	<div
		class="fixed left-1/2 top-[12vh] z-[71] w-[min(92vw,40rem)] -translate-x-1/2 overflow-hidden rounded-xl border border-border/60 bg-popover shadow-2xl"
		role="dialog"
		aria-modal="true"
		aria-label="站内搜索"
		transition:fly={{ y: -12, duration: 160 }}
	>
		<div class="flex items-center gap-2 border-b border-border/60 px-3.5">
			<Search class="size-4 shrink-0 text-muted-foreground" />
			<input
				bind:this={inputEl}
				bind:value={q}
				class="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
				placeholder="搜索文章、教程、项目、页面…"
				aria-label="搜索关键词"
			/>
			{#if loading}
				<Loader2 class="size-3.5 shrink-0 animate-spin text-muted-foreground" />
			{/if}
			<button
				class="shrink-0 rounded-md text-muted-foreground transition-colors hover:text-foreground"
				onclick={() => (open = false)}
				aria-label="关闭搜索"
			><X class="size-4" /></button>
		</div>

		<div class="max-h-[52vh] overflow-y-auto">
			{#if !q.trim()}
				<div class="px-4 py-8 text-center text-sm text-muted-foreground">
					输入关键词开始搜索
					<div class="mt-2 flex flex-wrap items-center justify-center gap-2 text-xs">
						<span class="rounded border border-border/60 px-1.5 py-0.5">Ctrl</span>
						<span>+</span>
						<span class="rounded border border-border/60 px-1.5 py-0.5">K</span>
						<span class="text-muted-foreground/70">随时唤起</span>
					</div>
				</div>
			{:else if hits.length === 0 && !loading}
				<div class="px-4 py-8 text-center text-sm text-muted-foreground">
					没有找到与「{q}」相关的内容
					<button class="mt-2 block w-full text-xs text-primary hover:underline" onclick={goFullSearch}>
						前往搜索页查看全部结果 →
					</button>
				</div>
			{:else}
				<ul class="p-1.5">
					{#each hits as hit, i (hit.href + i)}
						{@const I = ICONS[hit.section] ?? FileText}
						<li>
							<button
								class="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors {i === cursor ? 'bg-accent' : 'hover:bg-accent/60'}"
								onclick={() => pick(hit)}
								onmouseenter={() => (cursor = i)}
							>
								<I class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
								<span class="min-w-0 flex-1">
									<span class="block truncate text-sm font-medium">{hit.title}</span>
									{#if hit.snippet}
										<span class="mt-0.5 block truncate text-xs text-muted-foreground">{hit.snippet}</span>
									{/if}
								</span>
								{#if hit.sectionLabel}
									<span class="mt-0.5 shrink-0 rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">{hit.sectionLabel}</span>
								{/if}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<!-- 底栏：快捷键提示 + 完整搜索页出口 -->
		<div class="flex items-center justify-between border-t border-border/60 px-3.5 py-2 text-[11px] text-muted-foreground">
			<span class="flex items-center gap-2">
				<span class="flex items-center gap-1"><CornerDownLeft class="size-3" /> 打开</span>
				<span>↑↓ 选择</span>
				<span>Esc 关闭</span>
			</span>
			<button class="transition-colors hover:text-primary" onclick={goFullSearch}>完整搜索页 →</button>
		</div>
	</div>
{/if}
