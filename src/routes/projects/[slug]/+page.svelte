<script lang="ts">
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Button } from "$lib/components/ui/button/index.js";
	import { ArrowLeft, Rocket, Globe, Pencil, Star, GitFork, Clock, AlertTriangle, CircleDot, Package, GitCommitHorizontal, BookOpen, ListChecks, MessageSquare, Download } from "@lucide/svelte";
	import { Github } from "$lib/components/icons/index.js";
	import Comments from "$lib/components/comments.svelte";
	import ViewTracker from "$lib/components/view-tracker.svelte";
	import Heatmap from "$lib/components/board/heatmap.svelte";
	import ProgressPanel from "$lib/components/board/progress-panel.svelte";
	import IssuesPanel from "$lib/components/board/issues-panel.svelte";
	import ReleasesPanel from "$lib/components/board/releases-panel.svelte";
	import Seo from "$lib/components/Seo.svelte";
	import { can } from "$lib/permissions.js";

	let {
		data
	}: {
		data: {
			project: any;
			html: string;
			board: any | null;
			/** 装机卡片（仅星集控项目）：被控端/管理端版本实时取云端 ota */
			downloads?: any[] | null;
			issues: any[];
			stats: { open: number; closed: number; total: number };
			hasGithubToken: boolean;
			canEdit?: boolean;
			user?: { username: string; role: string } | null;
		};
	} = $props();

	const board = $derived(data.board);
	const sync = $derived(board?.sync ?? null);

	// 有展板就默认进「概览」，否则只显示正文
	let tab = $state<"overview" | "progress" | "issues" | "releases">("overview");

	const tabs = $derived.by(() => {
		const list: { k: "overview" | "progress" | "issues" | "releases"; t: string; icon: any; badge?: number }[] = [
			{ k: "overview", t: "概览", icon: BookOpen }
		];
		if (board?.todos?.length) list.push({ k: "progress", t: "进度待办", icon: ListChecks, badge: board.todos.filter((t: any) => !t.done).length });
		list.push({ k: "issues", t: "Issues", icon: MessageSquare, badge: data.stats.open });
		if (board?.releases?.length) list.push({ k: "releases", t: "发行下载", icon: Download, badge: board.releases.length });
		return list;
	});

	const canSubmit = $derived(!!data.user && can(data.user.role as any, "submitIssue"));
	const canModerate = $derived(!!data.user && can(data.user.role as any, "moderate"));

	function relTime(iso: string): string {
		if (!iso) return "";
		const diff = Date.now() - new Date(iso).getTime();
		if (!Number.isFinite(diff)) return "";
		const d = Math.floor(diff / 86400000);
		if (d <= 0) return "今天";
		if (d === 1) return "昨天";
		if (d < 30) return `${d} 天前`;
		if (d < 365) return `${Math.floor(d / 30)} 个月前`;
		return `${Math.floor(d / 365)} 年前`;
	}
</script>

{#if data.project}
<Seo
	title={data.project.title}
	description={data.project.excerpt || data.project.title}
	path={`/projects/${data.project.slug}`}
	ogType="article"
	publishedTime={data.project.date}
	modifiedTime={data.project.updated || data.project.date}
	tags={data.project.tags || []}
	jsonLd={[
		{
			"@context": "https://schema.org",
			"@type": "Article",
			headline: data.project.title,
			description: data.project.excerpt || data.project.title,
			datePublished: data.project.date,
			dateModified: data.project.updated || data.project.date,
			author: { "@type": "Organization", name: "Stelarith" },
			publisher: { "@type": "Organization", name: "Stelarith" },
			mainEntityOfPage: `${data.siteUrl}/projects/${data.project.slug}`,
			inLanguage: "zh-CN"
		},
		{
			"@context": "https://schema.org",
			"@type": "BreadcrumbList",
			itemListElement: [
				{ "@type": "ListItem", position: 1, name: "首页", item: data.siteUrl },
				{ "@type": "ListItem", position: 2, name: "项目", item: `${data.siteUrl}/projects` },
				{ "@type": "ListItem", position: 3, name: data.project.title, item: `${data.siteUrl}/projects/${data.project.slug}` }
			]
		}
	]}
/>
{/if}

<ViewTracker target={"projects:" + data.project.slug} />

<div class="ef-shell flex flex-col gap-6 py-10">
	<div class="flex items-center justify-between">
		<a href="/projects" class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
			<ArrowLeft class="size-4" />
			返回项目
		</a>
		{#if data.canEdit}
			<div class="flex items-center gap-2">
				<a
					href="/admin/project-board"
					class="inline-flex items-center gap-1 rounded-md border border-border/60 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
				>展板管理</a>
				<a
					href="/admin/projects/{data.project.slug}"
					class="inline-flex items-center gap-1 rounded-md border border-border/60 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
				><Pencil class="size-3" /> 编辑</a>
			</div>
		{/if}
	</div>

	<!-- 头部 -->
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
					{#if board?.repo}
						<span class="font-mono">{board.repo}</span>
					{/if}
				</div>
			</div>
		</div>

		{#if data.project.excerpt}
			<p class="text-muted-foreground">{data.project.excerpt}</p>
		{/if}

		<div class="flex flex-wrap gap-2">
			{#if data.project.repoUrl || board?.repo}
				<a href={data.project.repoUrl || `https://github.com/${board.repo}`} target="_blank" rel="noopener noreferrer">
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

	<!-- 展板统计条 -->
	{#if sync && !sync.error}
		<div class="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border/60 bg-card px-4 py-3 text-xs text-muted-foreground">
			<span class="inline-flex items-center gap-1"><Star class="size-3.5" />{sync.stars} Star</span>
			<span class="inline-flex items-center gap-1"><GitFork class="size-3.5" />{sync.forks} Fork</span>
			<span class="inline-flex items-center gap-1"><GitCommitHorizontal class="size-3.5" />近一年 {sync.commitTotal} 次提交</span>
			<span class="inline-flex items-center gap-1"><CircleDot class="size-3.5" />{data.stats.open} 打开 Issue</span>
			{#if board?.releases?.length}
				<span class="inline-flex items-center gap-1"><Package class="size-3.5" />{board.releases.length} 个发行</span>
			{/if}
			{#if sync.language}<span class="rounded-full bg-muted px-2 py-0.5">{sync.language}</span>{/if}
			{#if sync.license}<span class="rounded-full bg-muted px-2 py-0.5">{sync.license}</span>{/if}
			<span class="ml-auto inline-flex items-center gap-1"><Clock class="size-3.5" />{relTime(sync.at)}同步</span>
		</div>
	{:else if sync?.error}
		<div class="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
			<AlertTriangle class="mt-0.5 size-4 shrink-0" />
			<div>
				<p class="font-medium">仓库同步失败</p>
				<p class="mt-0.5">{sync.error}</p>
			</div>
		</div>
	{/if}

	<!-- Tab 切换（Issues 常驻；进度待办 / 发行下载 视展板数据出现）-->
	<div class="flex flex-wrap overflow-hidden rounded-md border border-border/60">
		{#each tabs as t (t.k)}
			<button
				type="button"
				class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors {tab === t.k
					? 'bg-primary/15 text-primary'
					: 'text-muted-foreground hover:bg-muted/60'}"
				onclick={() => (tab = t.k)}
			>
				<t.icon class="size-3.5" />
				{t.t}
				{#if t.badge}<span class="rounded-full bg-muted px-1.5 text-[10px]">{t.badge}</span>{/if}
			</button>
		{/each}
	</div>

	<!-- Tab 内容 -->
	{#if tab === "overview"}
		<div class="flex flex-col gap-6">
			{#if board && sync && !sync.error}
				<Heatmap contrib={board.contrib ?? {}} weeks={53} label="提交活跃度" sub={board.repo} />
			{:else if board && !board.repo}
				<p class="rounded-xl border border-dashed border-border/60 px-4 py-3 text-sm text-muted-foreground">
					该项目尚未绑定仓库，暂无活跃度数据。
				</p>
			{/if}

			{#if data.downloads?.length}
				<div class="flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-5">
					<div class="flex items-center gap-2">
						<Download class="size-4 text-primary" />
						<h3 class="font-heading text-sm font-medium">装机包下载</h3>
						<span class="ml-auto text-xs text-muted-foreground">版本实时取云端</span>
					</div>
					{#each data.downloads as d (d.key)}
						<div class="flex flex-wrap items-center justify-between gap-3 border-t border-border/40 pt-3">
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<span class="text-sm font-medium">{d.name}</span>
									{#if d.published}<Badge variant="secondary">v{d.version}</Badge>
									{:else}<Badge variant="outline">未发布</Badge>{/if}
								</div>
								<p class="mt-0.5 text-xs text-muted-foreground">{d.desc}</p>
							</div>
							{#if d.published}
								<Button href={d.url} target="_blank" rel="noopener">
									<Download class="size-4" />下载（{d.sizeText}）
								</Button>
							{:else}
								<span class="text-xs text-amber-500">{d.error || "暂时取不到版本信息"}</span>
							{/if}
						</div>
					{/each}
				</div>
			{/if}

			<article class="prose prose-invert max-w-none">
				{@html data.html}
			</article>
		</div>
	{:else if tab === "progress"}
		<ProgressPanel todos={board.todos} milestones={board.milestones} />
	{:else if tab === "issues"}
		<IssuesPanel
			slug={data.project.slug}
			issues={data.issues}
			stats={data.stats}
			user={data.user}
			{canSubmit}
			{canModerate}
		/>
	{:else if tab === "releases"}
		<ReleasesPanel slug={data.project.slug} releases={board.releases} />
	{/if}

	<Comments target={"projects:" + data.project.slug} user={data.user} />

	<footer class="border-t border-border/40 pt-6">
		{#if data.canEdit}
			<a href="/admin/projects/{data.project.slug}" class="text-xs text-muted-foreground hover:text-primary">编辑此项目</a>
		{/if}
	</footer>
</div>
