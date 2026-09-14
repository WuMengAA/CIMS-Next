<script lang="ts">
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Rocket, Globe, GitPullRequestArrow } from "@lucide/svelte";
	import { Github } from "$lib/components/icons/index.js";
	import Container from "$lib/components/container.svelte";
	import PageHeader from "$lib/components/page-header.svelte";

	let { data }: { data: { projects: any[]; canEdit?: boolean; user?: { username: string; role: string } | null } } = $props();

	// 按 category 分组，使「星璃品牌」在前、「生态组件」在后，立起核心叙事
	const categoryOrder = ["星璃品牌", "生态组件"];
	const groups = (() => {
		const map = new Map<string, any[]>();
		for (const p of data.projects) {
			const key = p.category || "未分类";
			if (!map.has(key)) map.set(key, []);
			map.get(key)!.push(p);
		}
		return [...map.entries()].sort((a, b) => {
			const ia = categoryOrder.indexOf(a[0]);
			const ib = categoryOrder.indexOf(b[0]);
			return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
		});
	})();
</script>

<svelte:head>
	<title>项目 | Stelarith</title>
</svelte:head>

<Container>
	<PageHeader title="项目" description="我的个人项目与作品。" />

	{#if data.user}
		<div class="mb-4 flex justify-end">
			<a href="/apply/project" class="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary">
				<GitPullRequestArrow class="size-4" /> 申请软件专页
			</a>
		</div>
	{/if}

	{#if data.projects.length === 0}
		<div class="flex flex-col items-center gap-2 rounded-xl border border-dashed p-12 text-center text-muted-foreground">
			<Rocket class="size-8" />
		<p class="text-sm">还没有项目，去后台创建第一个吧。</p>
		{#if data.canEdit}
			<a href="/admin/projects/new" class="text-primary hover:underline">创建项目</a>
		{/if}
		</div>
	{:else}
	<div class="flex flex-col gap-10">
		{#each groups as [category, items] (category)}
			<section class="flex flex-col gap-4">
				<div class="flex items-center gap-3">
					<h2 class="font-heading text-xl font-semibold">{category}</h2>
					<span class="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{items.length}</span>
				</div>
				<div class="grid gap-4 sm:grid-cols-2">
					{#each items as project (project.slug)}
						<a href="/projects/{project.slug}" class="group flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-5 transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
							<div class="flex items-center justify-between">
								<div class="flex size-10 items-center justify-center rounded-md bg-primary/15 text-primary">
									<Rocket class="size-5" />
								</div>
								{#if project.category}
									<Badge variant="outline">{project.category}</Badge>
								{/if}
							</div>
							<h2 class="font-heading text-lg font-medium group-hover:text-primary">{project.title}</h2>
							<p class="line-clamp-3 text-sm text-muted-foreground">{project.excerpt}</p>
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
			</section>
		{/each}
	</div>
{/if}
</Container>