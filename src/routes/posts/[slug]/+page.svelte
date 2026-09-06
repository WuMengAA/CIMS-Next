<script lang="ts">
	import { onMount } from "svelte";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Button } from "$lib/components/ui/button/index.js";
	import { ArrowLeft, ArrowRight, Calendar, Tag, Pin, ListTree, BookOpen, Pencil } from "@lucide/svelte";
	import Comments from "$lib/components/comments.svelte";
	import ViewTracker from "$lib/components/view-tracker.svelte";

	let { data }: {
		data: {
			post: any;
			html: string;
			toc: { id: string; text: string; level: number }[];
			words: number;
			prev: any;
			next: any;
			canEdit?: boolean;
			user?: { username: string; role: string } | null;
		}
	} = $props();

	const readMinutes = $derived(Math.max(1, Math.round(data.words / 400)));
</script>

<svelte:head>
	<title>{data.post.title} | Stelarith</title>
	<meta name="description" content={data.post.excerpt || data.post.title} />
	<meta property="og:title" content={data.post.title} />
	<meta property="og:description" content={data.post.excerpt || data.post.title} />
	{#if data.post.cover}<meta property="og:image" content={data.post.cover} />{/if}
</svelte:head>

<ViewTracker target={"posts:" + data.post.slug} />

<div class="mx-auto flex w-full max-w-[1400px] flex-col gap-8 px-4 py-10 md:flex-row md:px-8">
	<!-- Main article -->
	<article class="min-w-0 flex-1">
		<div class="mb-6 flex items-center justify-between">
			<a href="/posts" class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
				<ArrowLeft class="size-4" />
				返回博客
			</a>
		{#if data.canEdit}
			<a href="/admin/posts/{data.post.slug}" class="inline-flex items-center gap-1 rounded-md border border-border/60 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary">
				<Pencil class="size-3" />
				编辑
			</a>
		{/if}
		</div>
		{#if data.toc.length > 0}
			<details class="mb-4 rounded-lg border border-border/60 bg-card lg:hidden">
				<summary class="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-sm font-medium">
					<ListTree class="size-4 text-primary" />
					目录
				</summary>
				<nav class="flex flex-col gap-1 border-t border-border/40 px-4 py-3">
					{#each data.toc as item (item.id)}
						<a href="#{item.id}" class="text-xs transition-colors hover:text-primary {item.level === 2 ? 'font-medium text-foreground' : 'pl-3 text-muted-foreground'}">{item.text}</a>
					{/each}
				</nav>
			</details>
		{/if}

		{#if data.post.cover}
			<div class="mb-6 overflow-hidden rounded-xl border border-border/60">
				<img src={data.post.cover} alt={data.post.title} fetchpriority="high" class="aspect-video w-full object-cover" />
			</div>
		{/if}

		<header class="mb-6 flex flex-col gap-3">
			<div class="flex flex-wrap items-center gap-2">
				{#if data.post.pinned}
					<Badge variant="secondary" class="gap-1"><Pin class="size-3" /> 置顶</Badge>
				{/if}
				{#if data.post.category}
					<Badge variant="outline">{data.post.category}</Badge>
				{/if}
			</div>
			<h1 class="font-heading text-3xl font-semibold tracking-tight">{data.post.title}</h1>
			<div class="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
				<span class="inline-flex items-center gap-1"><Calendar class="size-3" /> {data.post.date}</span>
				<span class="inline-flex items-center gap-1"><BookOpen class="size-3" /> {data.words.toLocaleString()} 字 · 约 {readMinutes} 分钟</span>
			</div>
			{#if data.post.excerpt}
				<p class="text-muted-foreground">{data.post.excerpt}</p>
			{/if}
			{#if (data.post.tags || []).length > 0}
				<div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
					<Tag class="size-3" />
					{#each data.post.tags as tag (tag)}
						<span class="rounded-full bg-accent px-2 py-0.5">{tag}</span>
					{/each}
				</div>
			{/if}
		</header>

		<div class="prose prose-invert max-w-none">
			{@html data.html}
		</div>

		<Comments target={"posts:" + data.post.slug} user={data.user} />

		<!-- Prev / Next -->
		<nav class="mt-10 grid gap-3 border-t border-border/40 pt-6 sm:grid-cols-2">
			{#if data.prev}
				<a href="/posts/{data.prev.slug}" class="group flex flex-col gap-1 rounded-lg border border-border/60 p-4 transition-colors hover:border-primary/40">
					<span class="inline-flex items-center gap-1 text-xs text-muted-foreground"><ArrowLeft class="size-3" /> 上一篇</span>
					<span class="line-clamp-1 text-sm font-medium group-hover:text-primary">{data.prev.title}</span>
				</a>
			{:else}
				<div class="hidden sm:block"></div>
			{/if}
			{#if data.next}
				<a href="/posts/{data.next.slug}" class="group flex flex-col items-end gap-1 rounded-lg border border-border/60 p-4 text-right transition-colors hover:border-primary/40">
					<span class="inline-flex items-center gap-1 text-xs text-muted-foreground">下一篇 <ArrowRight class="size-3" /></span>
					<span class="line-clamp-1 text-sm font-medium group-hover:text-primary">{data.next.title}</span>
				</a>
			{:else}
				<div class="hidden sm:block"></div>
			{/if}
		</nav>

		<footer class="mt-6 text-xs text-muted-foreground">
			{data.post.date} · {data.post.slug}
		</footer>
	</article>

	<!-- TOC sidebar -->
	{#if data.toc.length > 0}
		<aside class="hidden w-56 shrink-0 lg:block">
			<div class="sticky top-6 rounded-lg border border-border/60 bg-card p-4">
				<p class="mb-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
					<ListTree class="size-3" />
					目录
				</p>
				<nav class="flex flex-col gap-1.5">
					{#each data.toc as item (item.id)}
						<a
							href="#{item.id}"
							class="text-xs transition-colors hover:text-primary {item.level === 2 ? 'font-medium text-foreground' : 'pl-3 text-muted-foreground'}"
						>{item.text}</a
						>
					{/each}
				</nav>
			</div>
		</aside>
	{/if}
</div>