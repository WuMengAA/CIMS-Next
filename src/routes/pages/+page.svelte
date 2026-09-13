<script lang="ts">
	import { FileText } from "@lucide/svelte";
	import Container from "$lib/components/container.svelte";
	import PageHeader from "$lib/components/page-header.svelte";

	let { data }: { data: { pages: any[]; canEdit?: boolean } } = $props();
</script>

<svelte:head>
	<title>页面 | Stelarith</title>
</svelte:head>

<Container>
	<PageHeader title="页面" description="独立页面与自定义内容。" />

	{#if data.pages.length === 0}
		<div class="flex flex-col items-center gap-2 rounded-xl border border-dashed p-12 text-center text-muted-foreground">
			<FileText class="size-8" />
			<p class="text-sm">还没有页面。</p>
			{#if data.canEdit}
				<a href="/admin/pages/new" class="text-primary hover:underline">新建页面</a>
			{/if}
		</div>
	{:else}
		<div class="flex flex-col divide-y divide-border/40 rounded-xl border border-border/60 bg-card">
			{#each data.pages as page (page.slug)}
				<a href="/pages/{page.slug}" class="group flex items-center gap-3 p-4 transition-colors hover:bg-accent/40">
					<FileText class="size-4 shrink-0 text-muted-foreground" />
					<div class="flex-1">
						<h3 class="font-medium group-hover:text-primary">{page.title}</h3>
						{#if page.excerpt}
							<p class="line-clamp-1 text-xs text-muted-foreground">{page.excerpt}</p>
						{/if}
					</div>
					<span class="text-xs text-muted-foreground">{page.date}</span>
				</a>
			{/each}
		</div>
	{/if}
</Container>
