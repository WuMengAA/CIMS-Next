<script lang="ts">
	import { Rocket, GitPullRequestArrow, Star, CircleDot, Package, GitCommitHorizontal } from "@lucide/svelte";
	import Seo from "$lib/components/Seo.svelte";
	import { Github } from "$lib/components/icons/index.js";
	import Container from "$lib/components/container.svelte";
	import PageHeader from "$lib/components/page-header.svelte";
	import Heatmap from "$lib/components/board/heatmap.svelte";
	import BoardCard from "$lib/components/board/board-card.svelte";

	interface Summary {
		slug: string;
		title: string;
		excerpt: string;
		category: string;
		date: string;
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
		latestRelease: { tag: string; name: string; url: string; downloads: number } | null;
		commits: number;
		lastSyncAt: string;
		syncError: string;
		hasBoard: boolean;
	}

	let {
		data
	}: {
		data: {
			projects: any[];
			summaries: Summary[];
			contrib: Record<string, number>;
			perProject: Record<string, Record<string, number>>;
			hasBoardData: boolean;
			hasGithubToken: boolean;
			canEdit?: boolean;
			user?: { username: string; role: string } | null;
		};
	} = $props();

	// 只保留展板视图：列表视图与切换按钮已移除（版式统一，不再让访客选）。
	const categoryOrder = ["星璃品牌", "生态组件"];
	const groups = $derived.by(() => {
		const map = new Map<string, Summary[]>();
		for (const p of data.summaries) {
			const key = p.category || "未分类";
			if (!map.has(key)) map.set(key, []);
			map.get(key)!.push(p);
		}
		return [...map.entries()].sort((a, b) => {
			const ia = categoryOrder.indexOf(a[0]);
			const ib = categoryOrder.indexOf(b[0]);
			return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
		});
	});

	const totals = $derived.by(() => {
		const s = data.summaries;
		return {
			projects: s.length,
			repos: s.filter((x) => x.repo).length,
			commits: s.reduce((n, x) => n + x.commits, 0),
			openIssues: s.reduce((n, x) => n + x.issues.open, 0),
			releases: s.reduce((n, x) => n + x.releaseCount, 0),
			stars: s.reduce((n, x) => n + x.stars, 0)
		};
	});
</script>

<Seo
	title="项目"
	description="项目展板：进度、待办、活跃度、Issues 与发行下载。"
	path="/projects"
/>

<Container>
	<PageHeader title="项目" description="我的个人项目与作品 —— 进度、待办、活跃度与发行。" />

	<div class="mb-4 flex flex-wrap items-center gap-2">
		{#if data.user}
			<a
				href="/apply/project"
				class="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
			><GitPullRequestArrow class="size-4" /> 申请软件专页</a>
		{/if}
		{#if data.canEdit}
			<a
				href="/admin/project-board"
				class="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
			>展板管理</a>
		{/if}
	</div>

	{#if data.projects.length === 0}
		<div class="flex flex-col items-center gap-2 rounded-xl border border-dashed p-12 text-center text-muted-foreground">
			<Rocket class="size-8" />
			<p class="text-sm">还没有项目，去后台创建第一个吧。</p>
			{#if data.canEdit}
				<a href="/admin/projects/new" class="text-primary hover:underline">创建项目</a>
			{/if}
		</div>
	{:else}
		<div class="flex flex-col gap-6">
			<!-- 全局统计 -->
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
				{#each [
					{ icon: Rocket, label: "项目", value: totals.projects },
					{ icon: Github, label: "已接仓库", value: totals.repos },
					{ icon: GitCommitHorizontal, label: "近一年提交", value: totals.commits },
					{ icon: CircleDot, label: "打开 Issue", value: totals.openIssues },
					{ icon: Package, label: "发行版", value: totals.releases },
					{ icon: Star, label: "Star", value: totals.stars }
				] as st}
					<div class="flex items-center gap-2.5 rounded-xl border border-border/60 bg-card px-3 py-2.5">
						<st.icon class="size-4 shrink-0 text-primary" />
						<div class="min-w-0">
							<p class="font-heading text-lg font-semibold leading-none">{st.value}</p>
							<p class="mt-0.5 truncate text-[11px] text-muted-foreground">{st.label}</p>
						</div>
					</div>
				{/each}
			</div>

			<!-- 全局活跃度（方块阵列） -->
			<Heatmap
				contrib={data.contrib}
				weeks={53}
				label="全局活跃度"
				sub={data.hasGithubToken ? "所有已绑定仓库的近一年提交" : "所有已绑定仓库 · 未配置 GITHUB_TOKEN（匿名配额 60/时）"}
			/>

			{#if !data.hasBoardData}
				<div class="rounded-xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
					还没有任何项目接入展板。{data.canEdit ? "" : "等站长配置后，这里会显示进度、活跃度与发行。"}
					{#if data.canEdit}<a href="/admin/project-board" class="text-primary hover:underline">去配置</a>{/if}
				</div>
			{/if}

			<!-- 分组展板卡 -->
			{#each groups as [category, items] (category)}
				<section class="flex flex-col gap-4">
					<div class="flex items-center gap-3">
						<h2 class="font-heading text-xl font-semibold">{category}</h2>
						<span class="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{items.length}</span>
					</div>
					<div class="grid gap-4 sm:grid-cols-2">
						{#each items as item (item.slug)}
							<BoardCard {item} contrib={data.perProject[item.slug] ?? {}} />
						{/each}
					</div>
				</section>
			{/each}
		</div>
	{/if}
</Container>
