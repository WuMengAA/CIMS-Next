<script lang="ts">
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Pencil } from "@lucide/svelte";
	import Comments from "$lib/components/comments.svelte";
	import ViewTracker from "$lib/components/view-tracker.svelte";

	let { data }: { data: { page: any; html: string; words: number; canEdit?: boolean; user?: { username: string; role: string } | null } } = $props();
</script>

<svelte:head>
	<title>{data.page.title} | Stelarith</title>
	<meta name="description" content={data.page.excerpt || data.page.title} />
	<meta property="og:title" content={data.page.title} />
	<meta property="og:type" content="article" />
</svelte:head>

<ViewTracker target={"pages:" + data.page.slug} />

<div class="mx-auto w-full max-w-[820px] px-4 py-10 md:px-8">
	{#if data.canEdit}
		<div class="mb-3 flex justify-end">
			<a href="/admin/pages/{data.page.slug}" class="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary">
				<Pencil class="size-3" /> 编辑
			</a>
		</div>
	{/if}
	<header class="mb-6 flex flex-col gap-3">
		<div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
			{#if data.page.category}<Badge variant="outline">{data.page.category}</Badge>{/if}
			<span>{data.page.date} · {data.words.toLocaleString()} 字</span>
		</div>
		<h1 class="font-heading text-3xl font-semibold tracking-tight">{data.page.title}</h1>
	</header>

	<div class="prose prose-invert max-w-none">
		{@html data.html}
	</div>

	<Comments target={"pages:" + data.page.slug} user={data.user} />

	<footer class="mt-8 border-t border-border/40 pt-6">
		<a href="/pages" class="text-xs text-muted-foreground hover:text-primary">← 返回页面列表</a>
	</footer>
</div>
