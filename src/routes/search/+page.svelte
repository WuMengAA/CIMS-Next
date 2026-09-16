<script lang="ts">
	import { Search, FileText, Rocket, BookMarked } from "@lucide/svelte";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import Container from "$lib/components/container.svelte";
	import PageHeader from "$lib/components/page-header.svelte";
	import HighlightText from "$lib/components/highlight-text.svelte";

	interface Hit {
		section: string;
		sectionLabel: string;
		slug: string;
		title: string;
		href: string;
		date: string;
		category?: string;
		tags?: string[];
		score: number;
		snippet: string;
		ranges: { start: number; end: number }[];
		titleHit: boolean;
		titleRanges: { start: number; end: number }[];
	}

	let {
		data
	}: {
		data: {
			q: string;
			section: string;
			result: { query: string; terms: string[]; total: number; hits: Hit[]; bySection: Record<string, number> };
			suggestions: string[];
			sections: { key: string; label: string }[];
		};
	} = $props();

	// 各栏目图标：只从本文件顶部已导入的图标里取，避免引入新的图标模块
	const iconMap: Record<string, any> = {
		posts: FileText,
		projects: Rocket,
		docs: BookMarked,
		pages: FileText
	};

	// 栏目筛选链接：保留当前查询词，只切换 section
	function sectionHref(key: string) {
		const params = new URLSearchParams();
		if (data.q) params.set("q", data.q);
		if (key) params.set("section", key);
		const s = params.toString();
		return "/search" + (s ? `?${s}` : "");
	}
</script>

<svelte:head>
	<title>{data.q ? `${data.q} · 搜索` : "搜索"} | Stelarith</title>
	{#if data.q}<meta name="robots" content="noindex, follow" />{/if}
</svelte:head>

<Container class="gap-8">
	<PageHeader title="全站搜索" description="一次检索博客、项目、教程与页面的标题、标签与正文。" />

	<form action="/search" method="GET" class="flex flex-col gap-3" role="search">
		<div class="relative">
			<Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
			<input
				type="search"
				name="q"
				value={data.q}
				placeholder="输入关键词，例如「体素」「CUE 分轨」「DeepSeek」"
				autocomplete="off"
				class="h-11 w-full rounded-lg border border-border/60 bg-card pr-3 pl-9 text-sm outline-none transition-colors focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/30"
			/>
		</div>
		{#if data.section}<input type="hidden" name="section" value={data.section} />{/if}
		<div class="flex flex-wrap items-center gap-2">
			<a
				href={sectionHref("")}
				class="rounded-full border px-3 py-1 text-xs transition-colors {data.section === ''
					? 'border-primary/60 bg-primary/15 text-primary'
					: 'border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground'}"
				>全部{data.result.total ? ` · ${data.result.total}` : ""}</a
			>
			{#each data.sections as s (s.key)}
				<a
					href={sectionHref(s.key)}
					class="rounded-full border px-3 py-1 text-xs transition-colors {data.section === s.key
						? 'border-primary/60 bg-primary/15 text-primary'
						: 'border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground'}"
					>{s.label}{data.result.bySection[s.key] ? ` · ${data.result.bySection[s.key]}` : ""}</a
				>
			{/each}
		</div>
	</form>

	{#if !data.q}
		<div class="flex flex-col gap-4 rounded-xl border border-dashed border-border/60 p-8">
			<p class="text-sm text-muted-foreground">输入关键词开始检索。试试这些常用标签：</p>
			<div class="flex flex-wrap gap-2">
				{#each data.suggestions as tag (tag)}
					<a
						href={`/search?q=${encodeURIComponent(tag)}`}
						class="rounded-full border border-border/60 bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
						>{tag}</a
					>
				{/each}
			</div>
		</div>
	{:else if data.result.total === 0}
		<div class="flex flex-col items-center gap-2 rounded-xl border border-dashed p-12 text-center text-muted-foreground">
			<Search class="size-8" />
			<p class="text-sm">没有找到与「{data.q}」相关的内容。</p>
			<p class="text-xs">试试更短的关键词，或换一个说法。</p>
		</div>
	{:else}
		<p class="text-sm text-muted-foreground">
			共找到 <span class="font-medium text-foreground">{data.result.total}</span> 条结果 · 关键词「{data.q}」
		</p>
		<div class="flex flex-col gap-3">
			{#each data.result.hits as hit (hit.section + "/" + hit.slug)}
				{@const Icon = iconMap[hit.section] || FileText}
				<a
					href={hit.href}
					class="group flex flex-col gap-2 rounded-xl border border-border/60 bg-card p-5 transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
				>
					<div class="flex items-center gap-2">
						<span class="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
							<Icon class="size-3.5" />
						</span>
						<Badge variant="outline" class="shrink-0">{hit.sectionLabel}</Badge>
						<h2 class="min-w-0 flex-1 truncate font-heading text-base font-medium group-hover:text-primary">
							<HighlightText text={hit.title} ranges={hit.titleHit ? hit.titleRanges : []} />
						</h2>
					</div>
					{#if hit.snippet}
						<p class="line-clamp-2 text-sm text-muted-foreground">
							<HighlightText text={hit.snippet} ranges={hit.ranges} />
						</p>
					{/if}
					<div class="mt-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
						<span>{hit.date}</span>
						{#if hit.category}<span class="rounded bg-muted px-1.5 py-0.5">{hit.category}</span>{/if}
						{#each (hit.tags || []).slice(0, 3) as t (t)}<span>#{t}</span>{/each}
					</div>
				</a>
			{/each}
		</div>
	{/if}
</Container>
