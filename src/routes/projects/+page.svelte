<script lang="ts">
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Rocket, Globe } from "@lucide/svelte";
	import { Github } from "$lib/components/icons/index.js";

	let { data }: { data: { projects: any[] } } = $props();
</script>

<svelte:head>
	<title>项目 | Stelarith</title>
</svelte:head>

<div class="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-10 md:px-8">
	<header class="reveal flex flex-col gap-2" style="--reveal-delay:0">
		<h1 class="font-heading text-3xl font-semibold tracking-tight">项目</h1>
		<p class="text-sm text-muted-foreground">我的个人项目与作品。</p>
	</header>

	{#if data.projects.length === 0}
		<div class="flex flex-col items-center gap-2 rounded-xl border border-dashed p-12 text-center text-muted-foreground">
			<Rocket class="size-8" />
			<p class="text-sm">还没有项目，去后台创建第一个吧。</p>
			<a href="/admin/projects/new" class="text-primary hover:underline">创建项目</a>
		</div>
{:else}
	<div class="grid gap-4 sm:grid-cols-2">
		{#each data.projects as project (project.slug)}
			<a href="/projects/{project.slug}" class="group flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-5 transition-colors hover:border-primary/50">
				<div class="flex items-center justify-between">
					<div class="flex size-10 items-center justify-center rounded-md bg-primary/15 text-primary">
						<Rocket class="size-5" />
					</div>
					{#if project.category}
						<Badge variant="outline">{project.category}</Badge>
					{/if}
				</div>
				<h2 class="font-heading text-lg font-medium group-hover:text-primary">{project.title}</h2>
				<p class="line-clamp-3 text-sm text-muted-foreground">{project.excerpt || project.body.slice(0, 120)}</p>
				<div class="mt-auto flex items-center gap-3 text-xs text-muted-foreground">
					<span>{project.date}</span>
					{#if project.repoUrl}
						<span class="inline-flex items-center gap-1"><Github class="size-3" /> GitHub</span>
					{/if}
					{#if project.siteUrl}
						<span class="inline-flex items-center gap-1"><Globe class="size-3" /> 在线</span>
					{/if}
				</div>
			</a>
		{/each}
	</div>
{/if}
</div>