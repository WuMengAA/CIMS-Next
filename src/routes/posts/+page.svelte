<script lang="ts">
	import { Input } from "$lib/components/ui/input/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Search, Pin, FileText } from "@lucide/svelte";
	import Container from "$lib/components/container.svelte";
	import PageHeader from "$lib/components/page-header.svelte";

	let { data }: { data: { posts: any[]; categories: string[] } } = $props();

	let keyword = $state("");
	let activeCategory = $state("全部");

	const filtered = $derived(
		data.posts.filter((p: any) => {
			const matchCategory =
				activeCategory === "全部" ||
				p.category === activeCategory ||
				(p.tags || []).includes(activeCategory);
			const matchKeyword =
				keyword.trim() === "" ||
				p.title.toLowerCase().includes(keyword.trim().toLowerCase()) ||
				(p.excerpt || "").toLowerCase().includes(keyword.trim().toLowerCase()) ||
				(p.tags || []).some((t: string) => t.toLowerCase().includes(keyword.trim().toLowerCase()));
			return matchCategory && matchKeyword;
		})
	);
</script>

<svelte:head>
	<title>博客 | Stelarith</title>
</svelte:head>

<Container>
	<PageHeader title="博客" description="记录开发、追番、工具与生活的随笔。" />

	<div class="relative">
		<Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
		<Input bind:value={keyword} placeholder="搜索文章" class="pl-9" />
	</div>

	<div class="flex flex-wrap gap-2">
		{#each data.categories as c (c)}
			<button
				type="button"
				class="rounded-full border px-3 py-1 text-xs transition-colors {activeCategory === c
					? 'border-primary bg-primary/15 text-primary'
					: 'border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground'}"
				onclick={() => (activeCategory = c)}
			>
				{c}
			</button>
		{/each}
	</div>

	<div class="flex flex-col divide-y divide-border/40 rounded-xl border border-border/60 bg-card">
		{#each filtered as post (post.slug)}
			<a
				href="/posts/{post.slug}"
				class="group flex flex-col gap-2 p-5 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
			>
				<div class="flex flex-wrap items-center gap-2">
					{#if post.pinned}
						<Badge variant="secondary" class="gap-1 text-xs">
							<Pin class="size-3" />
							置顶
						</Badge>
					{/if}
					<span class="text-xs text-muted-foreground">{post.date} · {post.words.toLocaleString()} 字</span>
					<Badge variant="outline" class="ml-auto text-xs">{post.category}</Badge>
				</div>
				<h2 class="font-heading text-lg font-medium group-hover:text-primary">
					{post.title}
				</h2>
				<p class="line-clamp-2 text-sm text-muted-foreground">{post.excerpt}</p>
			</a>
		{/each}
		{#if filtered.length === 0}
			<div class="flex flex-col items-center gap-2 p-12 text-muted-foreground">
				<FileText class="size-8" />
				<p class="text-sm">没有找到相关文章</p>
			</div>
		{/if}
	</div>
</Container>