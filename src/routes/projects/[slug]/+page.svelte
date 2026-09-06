<script lang="ts">
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Button } from "$lib/components/ui/button/index.js";
	import { ArrowLeft, Rocket, Globe, Pencil } from "@lucide/svelte";
	import { Github } from "$lib/components/icons/index.js";

	let { data }: { data: { project: any; html: string; canEdit?: boolean } } = $props();
</script>

<svelte:head>
	<title>{data.project.title} | Stelarith</title>
	<meta name="description" content={data.project.excerpt || data.project.title} />
</svelte:head>

<div class="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 md:px-8">
	<div class="flex items-center justify-between">
		<a href="/projects" class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
			<ArrowLeft class="size-4" />
			返回项目
		</a>
		{#if data.canEdit}
			<a href="/admin/projects/{data.project.slug}" class="inline-flex items-center gap-1 rounded-md border border-border/60 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary">
				<Pencil class="size-3" />
				编辑
			</a>
		{/if}
	</div>

	<header class="flex flex-col gap-4">
		<div class="flex items-center gap-3">
			<div class="flex size-12 items-center justify-center rounded-md bg-primary/15 text-primary">
				<Rocket class="size-6" />
			</div>
			<div class="flex flex-col gap-1">
				<h1 class="font-heading text-3xl font-semibold tracking-tight">{data.project.title}</h1>
				<div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
					<span>{data.project.date}</span>
					{#if data.project.category}
						<Badge variant="outline">{data.project.category}</Badge>
					{/if}
				</div>
			</div>
		</div>
		{#if data.project.excerpt}
			<p class="text-muted-foreground">{data.project.excerpt}</p>
		{/if}
		<div class="flex flex-wrap gap-2">
			{#if data.project.repoUrl}
				<a href={data.project.repoUrl} target="_blank" rel="noopener noreferrer">
					<Button variant="outline" size="sm"><Github class="size-4 mr-1" /> GitHub</Button>
				</a>
			{/if}
			{#if data.project.siteUrl}
				<a href={data.project.siteUrl} target="_blank" rel="noopener noreferrer">
					<Button variant="outline" size="sm"><Globe class="size-4 mr-1" /> 在线访问</Button>
				</a>
			{/if}
		</div>
	</header>

	<article class="prose prose-invert max-w-none">
		{@html data.html}
	</article>

	<footer class="border-t border-border/40 pt-6">
		{#if data.canEdit}
			<a href="/admin/projects/{data.project.slug}" class="text-xs text-muted-foreground hover:text-primary">编辑此项目</a>
		{/if}
	</footer>
</div>