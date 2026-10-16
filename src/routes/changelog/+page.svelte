<script lang="ts">
	/** 更新日志：按版本倒序，每个版本一条可展开明细。 */
	import Container from "$lib/components/container.svelte";
	import Seo from "$lib/components/Seo.svelte";
	import PageHeader from "$lib/components/page-header.svelte";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	// CHANGE_KIND_LABELS 是纯展示常量（不含敏感信息），内联于此 ——
	// 不能从 $lib/server/* import（SvelteKit 守卫会拦截浏览器侧引用）。
	const CHANGE_KIND_LABELS: Record<string, string> = {
		feat: "新增",
		fix: "修复",
		change: "调整",
		chore: "其它"
	};
	import { History, Rocket, Search, ChevronDown, Target, ArrowRight } from "@lucide/svelte";

	let { data }: { data: import("./$types").PageData } = $props();

	let open = $state<Record<string, boolean>>({});
	let filter = $state("all");
	let keyword = $state("");

	const KIND_STYLE: Record<string, string> = {
		feat: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
		fix: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30",
		change: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30",
		chore: "bg-muted text-muted-foreground border-border/60"
	};

	const filtered = $derived(
		data.entries.map((e) => ({
			...e,
			items: e.items.filter(
				(i) =>
					(filter === "all" || i.kind === filter) &&
					(!keyword.trim() ||
						(e.title + e.highlight + i.text).toLowerCase().includes(keyword.trim().toLowerCase()))
			)
		}))
	);
	const shown = $derived(filtered.filter((e) => e.items.length > 0));
</script>

<Seo
	title="更新日志"
	description="每一次改动都记下来：新增了什么、修了什么、调整了什么。"
	path="/changelog"
/>

<Container class="py-10">
	<PageHeader title="更新日志" description="每一次改动都记下来：新增了什么、修了什么、调整了什么。" />

	<!-- 概览 -->
	<div class="mt-6 flex flex-col gap-4 rounded-xl border border-border/60 bg-card p-5">
		<div class="flex flex-wrap items-center gap-2">
			<History class="size-4 text-primary" />
			<span class="text-sm font-medium">共 {data.entries.length} 个版本</span>
			{#each data.counts as c}
				{#if c.n}
					<Badge variant="outline">{c.label} {c.n}</Badge>
				{/if}
			{/each}
		</div>
		<div class="flex flex-wrap gap-2">
			<!-- 「全部」与服务端统计的形状要一致（kind/label），否则 TS 会把数组推成联合类型 -->
			{#each [{ kind: "all", label: "全部" }, ...data.counts] as opt}
				<Button
					variant={filter === opt.kind ? "secondary" : "ghost"}
					size="sm"
					onclick={() => (filter = opt.kind)}
				>{opt.label}</Button>
			{/each}
			<div class="relative ml-auto min-w-40">
				<Search class="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
				<Input bind:value={keyword} placeholder="搜索改动" class="h-8 pl-8 text-sm" />
			</div>
		</div>
	</div>

	<!-- 开发进度 -->
	{#if data.roadmap.items.length}
		<div class="mt-6 rounded-xl border border-border/60 bg-card p-5">
			<div class="flex items-center gap-2">
				<Rocket class="size-4 text-primary" />
				<h2 class="font-heading text-lg font-medium">项目开发进度</h2>
				{#if data.roadmap.updated}
					<span class="ml-auto text-xs text-muted-foreground">更新于 {data.roadmap.updated}</span>
				{/if}
			</div>
			<div class="mt-4 grid gap-3 sm:grid-cols-2">
				{#each data.roadmap.items as r}
					<div class="rounded-lg border border-border/50 p-4">
						<div class="flex items-start justify-between gap-2">
							<div class="min-w-0">
								<p class="truncate text-sm font-medium">{r.project}</p>
								<p class="text-xs text-muted-foreground">{r.phase}</p>
							</div>
							<span class="shrink-0 text-sm font-medium tabular-nums">{r.progress}%</span>
						</div>
						<div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
							<div class="h-full rounded-full bg-primary" style="width:{r.progress}%"></div>
						</div>
						<p class="mt-2 truncate text-xs text-primary">下一步：{r.next || "—"}</p>
						{#if r.note}<p class="mt-1 text-xs text-muted-foreground">{r.note}</p>{/if}
					</div>
				{/each}
			</div>
			<a href="/pulse" class="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline">
				到站点动态看更细的活跃度 <ArrowRight class="size-3" />
			</a>
		</div>
	{/if}

	<!-- 版本列表 -->
	<div class="mt-8 flex flex-col gap-6">
		{#each shown as e (e.version)}
			<article class="rounded-xl border border-border/60 bg-card p-5">
				<header class="flex flex-wrap items-center gap-2">
					<Badge variant="default" class="font-mono text-xs">{e.version}</Badge>
					<span class="text-xs text-muted-foreground">{e.date}</span>
					<h3 class="w-full font-heading text-lg font-medium">{e.title}</h3>
					{#if e.highlight}
						<p class="w-full text-sm text-muted-foreground">{e.highlight}</p>
					{/if}
					<Button
						variant="ghost"
						size="sm"
						class="ml-auto"
						onclick={() => (open[e.version] = !open[e.version])}
					>
						{open[e.version] ? "收起" : `展开 ${e.items.length} 条`}
						<ChevronDown class="ml-1 size-3.5 {open[e.version] ? 'rotate-180' : ''}" />
					</Button>
				</header>

				{#if open[e.version]}
					<ul class="mt-3 space-y-2 border-t border-border/40 pt-3">
						{#each e.items as it}
							<li class="flex gap-2 text-sm">
								<span
									class={"mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[10px] leading-5 " + (KIND_STYLE[it.kind] ?? KIND_STYLE.chore)}
								>
									{CHANGE_KIND_LABELS[it.kind] ?? "其它"}
								</span>
								<span class="min-w-0 text-muted-foreground">{it.text}</span>
							</li>
						{/each}
					</ul>
				{:else}
					<ul class="mt-3 flex flex-wrap gap-2 border-t border-border/40 pt-3">
						{#each e.items.slice(0, 4) as it}
							<li class="flex max-w-full items-center gap-1.5 text-xs text-muted-foreground">
								<span class={"shrink-0 rounded border px-1.5 text-[10px] " + (KIND_STYLE[it.kind] ?? KIND_STYLE.chore)}>
									{CHANGE_KIND_LABELS[it.kind] ?? "其它"}
								</span>
								<span class="truncate">{it.text}</span>
							</li>
						{/each}
						{#if e.items.length > 4}
							<li class="text-xs text-muted-foreground">…还有 {e.items.length - 4} 条</li>
						{/if}
					</ul>
				{/if}
			</article>
		{:else}
			<p class="rounded-xl border border-border/60 p-8 text-center text-sm text-muted-foreground">
				没有匹配的改动记录。
			</p>
		{/each}
	</div>
</Container>
