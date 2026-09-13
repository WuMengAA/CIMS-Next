<script lang="ts">
	import { onMount } from "svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { RefreshCw } from "@lucide/svelte";

	let postsCount = $state(0);
	let projectsCount = $state(0);
	let docsCount = $state(0);
	let mediaCount = $state(0);
	let commentsCount = $state(0);
	let announcementsCount = $state(0);
	let feedbackCount = $state(0);
	let pagesCount = $state(0);
	let pvToday = $state(0);
	let pvTotal = $state(0);
	let loading = $state(false);

	async function loadStats() {
		loading = true;
		try {
		const [p, pr, d, m, c, a, f, pg, s] = await Promise.all([
			fetch("/api/posts"),
			fetch("/api/projects"),
			fetch("/api/docs"),
			fetch("/api/media"),
			fetch("/api/comments?all=1"),
			fetch("/api/announcements?all=1"),
			fetch("/api/feedback"),
			fetch("/api/pages"),
			fetch("/api/stats?days=7")
		]);
		postsCount = (await p.json()).length;
		projectsCount = (await pr.json()).length;
		docsCount = (await d.json()).length;
		mediaCount = (await m.json()).length;
		commentsCount = (await c.json()).length;
		announcementsCount = (await a.json()).length;
		feedbackCount = (await f.json()).length;
		pagesCount = (await pg.json()).length;
		const stats = await s.json();
			pvToday = stats.today || 0;
			pvTotal = stats.total || 0;
		} catch (e) {
			console.error(e);
		}
		loading = false;
	}

	onMount(async () => { await loadStats(); });
</script>

<div class="mb-6">
	<h1 class="text-2xl font-heading font-semibold">仪表盘</h1>
	<p class="text-sm text-muted-foreground">内容概览与快速操作</p>
</div>

<div class="grid grid-cols-2 gap-4 mb-6">
	<a href="/admin/posts" class="block rounded-lg border bg-card p-4 hover:border-primary transition-colors">
		<div class="text-2xl font-semibold">{postsCount}</div>
		<div class="text-sm text-muted-foreground">博客文章</div>
	</a>
	<a href="/admin/projects" class="block rounded-lg border bg-card p-4 hover:border-primary transition-colors">
		<div class="text-2xl font-semibold">{projectsCount}</div>
		<div class="text-sm text-muted-foreground">项目</div>
	</a>
	<a href="/admin/docs" class="block rounded-lg border bg-card p-4 hover:border-primary transition-colors">
		<div class="text-2xl font-semibold">{docsCount}</div>
		<div class="text-sm text-muted-foreground">文档</div>
	</a>
	<a href="/admin/media" class="block rounded-lg border bg-card p-4 hover:border-primary transition-colors">
		<div class="text-2xl font-semibold">{mediaCount}</div>
		<div class="text-sm text-muted-foreground">媒体文件</div>
	</a>
	<a href="/admin/comments" class="block rounded-lg border bg-card p-4 hover:border-primary transition-colors">
		<div class="text-2xl font-semibold">{commentsCount}</div>
		<div class="text-sm text-muted-foreground">评论</div>
	</a>
	<a href="/admin/announcements" class="block rounded-lg border bg-card p-4 hover:border-primary transition-colors">
		<div class="text-2xl font-semibold">{announcementsCount}</div>
		<div class="text-sm text-muted-foreground">公告</div>
	</a>
	<a href="/admin/feedback" class="block rounded-lg border bg-card p-4 hover:border-primary transition-colors">
		<div class="text-2xl font-semibold">{feedbackCount}</div>
		<div class="text-sm text-muted-foreground">反馈</div>
	</a>
	<a href="/admin/pages" class="block rounded-lg border bg-card p-4 hover:border-primary transition-colors">
		<div class="text-2xl font-semibold">{pagesCount}</div>
		<div class="text-sm text-muted-foreground">页面</div>
	</a>
	<div class="block rounded-lg border bg-card p-4">
		<div class="text-2xl font-semibold">{pvToday}</div>
		<div class="text-sm text-muted-foreground">今日 PV（累计 {pvTotal}）</div>
	</div>
</div>

<div class="grid grid-cols-2 gap-4">
	<div class="rounded-lg border p-4">
		<h3 class="font-heading font-semibold mb-3">快速操作</h3>
		<div class="flex flex-col gap-2">
			<a href="/admin/posts" class="text-sm hover:text-primary">新建博客文章</a>
			<a href="/admin/projects" class="text-sm hover:text-primary">新建项目</a>
			<a href="/admin/docs" class="text-sm hover:text-primary">新建文档</a>
			<a href="/admin/media" class="text-sm hover:text-primary">上传媒体文件</a>
		</div>
	</div>
	<div class="rounded-lg border p-4">
		<h3 class="font-heading font-semibold mb-3">存储说明</h3>
		<p class="text-sm text-muted-foreground">内容以 Markdown 文件存储在 content/ 目录，媒体文件存储在 uploads/ 目录，支持 Git 版本控制。</p>
	</div>
</div>