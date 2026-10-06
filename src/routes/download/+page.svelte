<script lang="ts">
	/**
	 * 下载中心 —— 统一资源整合面板（2026-10-06 改版）。
	 * 装机引导卡片已迁移至 /projects/xingjikong（版本实时取云端 ota），
	 * 这里只做全站可下载资源的搜索、分类与跳转下载。
	 */
	import Container from "$lib/components/container.svelte";
	import PageHeader from "$lib/components/page-header.svelte";
	import { reveal } from "$lib/actions/reveal.js";
	import { Download, Search } from "@lucide/svelte";

	let { data }: { data: import("./$types").PageData } = $props();

	let query = $state(data.initialQ || "");
	let activeType = $state(data.initialType || "");
	let visible = $derived.by(() => {
		const q = query.trim().toLowerCase();
		let list = data.allItems;
		if (q) list = list.filter((i) => i.title.toLowerCase().includes(q) || (i.desc || "").toLowerCase().includes(q));
		if (activeType) list = list.filter((i) => i.type === activeType);
		return list;
	});
</script>

<svelte:head>
	<title>下载中心 | Stelarith 星集控</title>
	<meta name="description" content="星集控下载中心：项目发行、图片、视频、文档、应用 —— 统一搜索与下载。" />
</svelte:head>

<Container>
	<PageHeader
		title="下载中心"
		eyebrow="星集控 · 资源面板"
		description="全站可下载资源的统一入口：项目发行包、图片、视频、文档、应用。被控端/管理端装机包在「项目发行」分类里，或到项目页查看装机说明。"
	/>

	<!-- 搜索 + 分类 -->
	<div
		use:reveal
		class="reveal flex flex-wrap items-center gap-2"
		style="--reveal-delay:0"
	>
		<div class="relative min-w-52 flex-1">
			<Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
			<input
				bind:value={query}
				type="search"
				placeholder="搜索项目、图片、视频、文档、应用…"
				class="h-10 w-full rounded-lg border border-border/60 bg-card pr-3 pl-9 text-sm outline-none transition-colors focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/30"
			/>
		</div>
		{#each data.types as t}
			<button
				type="button"
				class:active={activeType === t.key}
				class="rounded-full border px-3 py-1.5 text-xs transition-colors {activeType === t.key
					? 'border-primary/60 bg-primary/15 font-medium text-primary'
					: 'border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground'}"
				onclick={() => { activeType = activeType === t.key ? "" : t.key }}
			>
				{t.label}
			</button>
		{/each}
	</div>

	<!-- 结果列表 -->
	<section
		use:reveal
		class="reveal mt-4 rounded-xl border border-border/60 bg-card p-5"
		style="--reveal-delay:1"
	>
		<div class="flex items-center justify-between gap-3">
			<h2 class="font-heading text-sm font-medium">全部资源</h2>
			<span class="text-xs text-muted-foreground">{visible.length} 项</span>
		</div>

		{#if visible.length === 0}
			<p class="py-8 text-center text-sm text-muted-foreground">
				{query ? `没有找到与「${query}」相关的资源` : "还没有可下载的资源"}
			</p>
		{:else}
			<ul class="mt-2 flex flex-col divide-y divide-border/40">
				{#each visible as it (it.id)}
					<li class="flex flex-wrap items-center gap-3 py-3">
						<span class="rounded border border-border px-1.5 py-px font-mono text-[10px] text-muted-foreground">{it.type}</span>
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm font-medium">{it.title}</p>
							{#if it.desc}
								<p class="truncate text-xs text-muted-foreground">{it.desc}</p>
							{/if}
						</div>
						<span class="text-xs text-muted-foreground">{it.date}</span>
						{#if it.url}
							<a
								href={it.url}
								target={it.url.startsWith("http") ? "_blank" : "_self"}
								rel="noopener"
								class="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1 text-xs transition-colors hover:border-primary/50 hover:text-primary"
							>
								<Download class="size-3.5" />
								下载
								<span class="text-muted-foreground">({it.sizeText})</span>
							</a>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</Container>
