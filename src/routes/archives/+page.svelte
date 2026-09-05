<script lang="ts">
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Archive, ChevronRight } from "@lucide/svelte";
	import Container from "$lib/components/container.svelte";
	import PageHeader from "$lib/components/page-header.svelte";

	const versions = [
		{ tag: "v19", title: "Astro 一体化主站", tech: "Astro + React", year: "2026" },
		{ tag: "v18", title: "Vuetify 重构", tech: "Vue + Vuetify", year: "2026" },
		{ tag: "v17", title: "React CSR → SSR", tech: "React", year: "2025" },
		{ tag: "SVAF", title: "SvelteKit + shadcn 时代", tech: "SvelteKit + shadcn-svelte", year: "2025" },
		{ tag: "v16", title: "Hexo 主题时代", tech: "Hexo", year: "2024" },
		{ tag: "v15", title: "WordPress 时代", tech: "WordPress", year: "2023" }
	];
</script>

<svelte:head>
	<title>旧站归档 | Stelarith</title>
</svelte:head>

<Container>
	<header class="flex flex-col gap-2">
		<div class="flex items-center gap-2">
			<Archive class="size-6 text-primary" />
			<h1 class="font-heading text-3xl font-semibold tracking-tight">旧站归档</h1>
		</div>
		<p class="text-sm text-muted-foreground">
			Stelarith 走过 20 次重构，这里保存着历代的存档与设计。
		</p>
	</header>

	<div class="flex flex-col divide-y divide-border/40 rounded-xl border border-border/60 bg-card">
		{#each versions as v (v.tag)}
			<a href="/archives/" class="group flex items-center gap-4 p-5 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
				<Badge variant="secondary" class="shrink-0 font-mono">{v.tag}</Badge>
				<div class="min-w-0 flex-1">
					<p class="truncate font-heading text-base font-medium group-hover:text-primary">
						{v.title}
					</p>
					<p class="truncate text-xs text-muted-foreground">{v.tech} · {v.year}</p>
				</div>
				<ChevronRight class="size-4 shrink-0 text-muted-foreground" />
			</a>
		{/each}
	</div>
</Container>
