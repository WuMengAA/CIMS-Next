<script lang="ts">
	import Container from "$lib/components/container.svelte";
	import PageHeader from "$lib/components/page-header.svelte";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Rss, ExternalLink, Newspaper, RefreshCw } from "@lucide/svelte";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	function fmtDate(iso?: string): string {
		if (!iso) return "";
		const d = new Date(iso);
		if (isNaN(d.getTime())) return "";
		return d.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
	}
</script>

<svelte:head>
	<title>新闻聚合 | Stelarith</title>
	<meta name="description" content="聚合自知名新闻与博客订阅源的热门内容。" />
	<link rel="alternate" type="application/rss+xml" title="Stelarith 博客 RSS" href="/rss.xml" />
</svelte:head>

<Container>
	<PageHeader title="新闻聚合" description="聚合自知名新闻与博客订阅源，一站速览。" />

	<div class="mb-5 flex flex-wrap items-center gap-3">
		<a
			href="/rss.xml"
			target="_blank"
			rel="noopener noreferrer"
			class="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
		>
			<Rss class="size-3.5" /> 订阅博客 RSS
		</a>
		<div class="flex flex-wrap items-center gap-1.5">
			{#each data.sources as s (s.name)}
				<Badge variant="outline" class="text-[10px]">{s.name}</Badge>
			{/each}
		</div>
	</div>

	{#if data.error}
		<div class="rounded-xl border border-dashed border-border/60 p-10 text-center text-sm text-muted-foreground">
			<Newspaper class="mx-auto mb-2 size-8" />
			{data.error}
		</div>
	{:else if data.items.length === 0}
		<div class="rounded-xl border border-dashed border-border/60 p-10 text-center text-sm text-muted-foreground">
			<Newspaper class="mx-auto mb-2 size-8" />
			暂无聚合内容（可能源暂不可达，或尚未抓取完成，稍后刷新看看～）
		</div>
	{:else}
		<div class="flex flex-col divide-y divide-border/40 rounded-xl border border-border/60 bg-card">
			{#each data.items as it (it.guid || it.link || it.title)}
				<a
					href={it.link}
					target="_blank"
					rel="noopener noreferrer"
					class="group flex flex-col gap-1.5 p-4 transition-colors hover:bg-accent/40"
				>
					<div class="flex flex-wrap items-center gap-2">
						{#if it.source}<Badge variant="secondary" class="text-[10px]">{it.source}</Badge>{/if}
						{#if it.category}<Badge variant="outline" class="text-[10px]">{it.category}</Badge>{/if}
						<span class="ml-auto text-xs text-muted-foreground">{fmtDate(it.pubDate)}</span>
					</div>
					<h2 class="flex items-center gap-1 font-heading text-base font-medium group-hover:text-primary">
						{it.title}
						<ExternalLink class="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
					</h2>
					{#if it.description}<p class="line-clamp-2 text-sm text-muted-foreground">{it.description}</p>{/if}
				</a>
			{/each}
		</div>
		<p class="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
			<RefreshCw class="size-3.5" /> 内容每 10 分钟聚合刷新一次，来自各源站，版权归原作者所有。
		</p>
	{/if}
</Container>
