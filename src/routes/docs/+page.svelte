<script lang="ts">
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { BookMarked, FileText } from "@lucide/svelte";
	import Container from "$lib/components/container.svelte";
	import PageHeader from "$lib/components/page-header.svelte";

	let { data }: { data: { docs: any[] } } = $props();

	// Group docs by category for wiki-style listing
	const groups = (() => {
		const map = new Map<string, any[]>();
		for (const doc of data.docs) {
			const key = doc.folder || doc.category || "未分类";
			if (!map.has(key)) map.set(key, []);
			map.get(key)!.push(doc);
		}
		return [...map.entries()];
	})();
</script>

<svelte:head>
	<title>文档 | Stelarith</title>
</svelte:head>

<Container>
	<PageHeader title="文档" description="Wiki 模式的文档资料库，用于记录知识、指南与笔记。" />

	{#if data.docs.length === 0}
		<div class="flex flex-col items-center gap-2 rounded-xl border border-dashed p-12 text-center text-muted-foreground">
			<BookMarked class="size-8" />
			<p class="text-sm">还没有文档，去后台创建第一篇吧。</p>
			<a href="/admin/docs/new" class="text-primary hover:underline">创建文档</a>
		</div>
{:else}
	<div class="flex flex-col gap-8">
		{#each groups as [category, docs] (category)}
			<section class="flex flex-col gap-3">
				<h2 class="font-heading text-xl font-semibold">{category}</h2>
				<div class="flex flex-col divide-y divide-border/40 rounded-xl border border-border/60 bg-card">
					{#each docs as doc (doc.slug)}
						<a href="/docs/{doc.slug}" class="group flex items-center gap-3 p-4 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
							<FileText class="size-4 shrink-0 text-muted-foreground" />
							<div class="flex-1">
								<h3 class="font-medium group-hover:text-primary">{doc.title}</h3>
								{#if doc.excerpt}
									<p class="line-clamp-1 text-xs text-muted-foreground">{doc.excerpt}</p>
								{/if}
							</div>
							<span class="text-xs text-muted-foreground">{doc.date}</span>
						</a>
					{/each}
				</div>
			</section>
		{/each}
	</div>
{/if}
</Container>