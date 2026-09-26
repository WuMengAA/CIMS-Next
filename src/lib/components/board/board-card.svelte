<script lang="ts">
	/**
	 * 展板视图的项目卡 —— 一屏内把「这个项目在动吗、做到哪了、有没有坑」讲清楚。
	 *
	 * 三块信息按重要性排序：**活跃度（迷你方块阵列）→ 进度 → 社区信号（star/fork/issue）**。
	 * 没绑定仓库的项目不会显示空图表，而是回落成一句「未绑定仓库」的引导，避免一片死格子。
	 */
	import { Star, GitFork, CircleDot, Package, Clock, AlertTriangle } from "@lucide/svelte";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import Heatmap from "./heatmap.svelte";

	export interface BoardCardData {
		slug: string;
		title: string;
		excerpt: string;
		category: string;
		repo: string;
		repoUrl: string;
		lang: string;
		license: string;
		stars: number;
		forks: number;
		openIssues: number;
		issues: { open: number; closed: number; total: number };
		progress: { done: number; total: number; percent: number } | null;
		releaseCount: number;
		commits: number;
		lastSyncAt: string;
		syncError: string;
	}

	let { item, contrib = {} }: { item: BoardCardData; contrib?: Record<string, number> } = $props();

	function relTime(iso: string): string {
		if (!iso) return "";
		const t = new Date(iso).getTime();
		if (!Number.isFinite(t)) return "";
		const diff = Date.now() - t;
		const d = Math.floor(diff / 86400000);
		if (d <= 0) return "今天";
		if (d === 1) return "昨天";
		if (d < 30) return `${d} 天前`;
		if (d < 365) return `${Math.floor(d / 30)} 个月前`;
		return `${Math.floor(d / 365)} 年前`;
	}

	const hasRepo = $derived(!!item.repo);
</script>

<a
	href="/projects/{item.slug}"
	class="group flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-5 transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
>
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0">
			<h3 class="font-heading text-base font-medium group-hover:text-primary">{item.title}</h3>
			<p class="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.excerpt || "暂无简介"}</p>
		</div>
		{#if item.category}
			<Badge variant="outline" class="shrink-0">{item.category}</Badge>
		{/if}
	</div>

	<!-- 活跃度 -->
	{#if hasRepo}
		<div class="flex flex-col gap-1.5">
			<div class="flex items-center justify-between text-[11px] text-muted-foreground">
				<span>近一年 {item.commits} 次提交</span>
				{#if item.lastSyncAt}
					<span class="inline-flex items-center gap-1"><Clock class="size-3" />{relTime(item.lastSyncAt)}同步</span>
				{/if}
			</div>
			<Heatmap {contrib} weeks={20} mini />
		</div>
	{:else}
		<div class="rounded-lg border border-dashed border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
			未绑定仓库 —— 活跃度与发行数据待接入
		</div>
	{/if}

	<!-- 进度 -->
	{#if item.progress}
		<div>
			<div class="mb-1 flex items-baseline justify-between text-[11px]">
				<span class="text-muted-foreground">进度</span>
				<span class="font-medium">{item.progress.done}/{item.progress.total} · {item.progress.percent}%</span>
			</div>
			<div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
				<div class="h-full rounded-full bg-primary transition-[width] duration-500" style="width:{item.progress.percent}%"></div>
			</div>
		</div>
	{/if}

	<!-- 社区信号 -->
	<div class="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
		{#if hasRepo}
			<span class="inline-flex items-center gap-1"><Star class="size-3" />{item.stars}</span>
			<span class="inline-flex items-center gap-1"><GitFork class="size-3" />{item.forks}</span>
		{/if}
		{#if item.issues.total > 0}
			<span class="inline-flex items-center gap-1"><CircleDot class="size-3" />{item.issues.open} 个 Issue</span>
		{/if}
		{#if item.releaseCount > 0}
			<span class="inline-flex items-center gap-1"><Package class="size-3" />{item.releaseCount} 个发行</span>
		{/if}
		{#if item.lang}
			<span class="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px]">{item.lang}</span>
		{/if}
		{#if item.syncError}
			<span class="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400" title={item.syncError}>
				<AlertTriangle class="size-3" />同步异常
			</span>
		{/if}
	</div>
</a>
