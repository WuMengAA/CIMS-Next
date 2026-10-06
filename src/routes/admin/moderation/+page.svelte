<script lang="ts">
	/**
	 * 审核中心（2026-10-06）：8 类审核收敛为单页面 tab 切换。
	 * 每 tab 内嵌原路由（同源 iframe），带登录态直接操作，不重复实现审核逻辑。
	 */
	import { onMount } from "svelte";
	import Container from "$lib/components/container.svelte";
	import PageHeader from "$lib/components/page-header.svelte";
	import { Badge } from "$lib/components/ui/badge/index.js";

	let { data }: { data: import("./$types").PageData } = $props();

	// tab 定义：需要 reviewPermission 的单独标记（权限申请）
	const TABS = $derived([
		{ key: "comments", label: "评论审核", url: "/admin/comments", need: true },
		{ key: "feedback", label: "反馈管理", url: "/admin/feedback", need: true },
		{ key: "forum", label: "论坛管理", url: "/admin/forum", need: true },
		{ key: "link-applications", label: "友链申请", url: "/admin/link-applications", need: true },
		{ key: "project-applications", label: "项目专页申请", url: "/admin/project-applications", need: true },
		{ key: "doc-corrections", label: "文档纠错", url: "/admin/doc-corrections", need: true },
		{ key: "role-requests", label: "权限申请", url: "/admin/role-requests", need: data.canReviewRoles }
	].filter((t) => t.need));

	let active = $state(TABS.some((t) => t.key === data.tab) ? data.tab : TABS[0]?.key ?? "");

	// 切 tab 更新 URL（保留 ?tab= 以便深链/刷新不丢）
	function switchTab(key: string) {
		active = key;
		history.replaceState(null, "", `/admin/moderation?tab=${key}`);
	}
</script>

<svelte:head>
	<title>审核中心 | Stelarith</title>
</svelte:head>

<Container class="gap-6">
	<PageHeader title="审核中心" eyebrow="后台 · 一站式审核" description="评论、反馈、论坛、友链、项目申请、文档纠错、权限申请 —— 全部在一个界面里处理，不再切来切去。" />

	<!-- tab 栏 -->
	<div class="flex flex-wrap items-center gap-2">
		{#each TABS as t (t.key)}
			<button
				type="button"
				class:active={active === t.key}
				class="rounded-full border px-3 py-1.5 text-xs transition-colors {active === t.key
					? 'border-primary/60 bg-primary/15 font-medium text-primary'
					: 'border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground'}"
				onclick={() => switchTab(t.key)}
			>
				{t.label}
			</button>
		{/each}
	</div>

	<!-- 内嵌对应审核页（同源 iframe，带登录态直接操作） -->
	<div class="overflow-hidden rounded-xl border border-border/60 bg-card">
		{#each TABS as t (t.key)}
			{#if active === t.key}
				<iframe
					src={t.url}
					title={t.label}
					class="block h-[calc(100vh-16rem)] min-h-[480px] w-full border-0 bg-background"
				></iframe>
			{/if}
		{/each}
	</div>
</Container>
