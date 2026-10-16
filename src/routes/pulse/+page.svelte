<script lang="ts">
	/** 站点活跃度（/pulse）：在线、热度、动态流、开发进度入口。 */
	import Container from "$lib/components/container.svelte";
	import PageHeader from "$lib/components/page-header.svelte";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { formatBytes } from "$lib/storage-quota.js";
	import { Activity, Users, Flame, Radio, HardDrive, ArrowRight } from "@lucide/svelte";
import Seo from "$lib/components/Seo.svelte";

	let { data }: { data: import("./$types").PageData } = $props();

	const maxHeat = $derived(Math.max(1, ...data.heat.map((h) => h.count)));
	const online = $derived(data.online.length);
	const sum = $derived(data.summary);

	// 近 30 天里有活动的天数 / 总天数 → 判断"这站是活的还是刚起来的"
	const activeDays = $derived(data.heat.filter((h) => h.count > 0).length);
	const totalHeat = $derived(data.heat.reduce((s, h) => s + h.count, 0));

	function ago(iso: string): string {
		const diff = Date.now() - new Date(iso).getTime();
		const m = Math.round(diff / 60000);
		if (m < 1) return "刚刚";
		if (m < 60) return `${m} 分钟前`;
		const h = Math.round(m / 60);
		if (h < 24) return `${h} 小时前`;
		return `${Math.round(h / 24)} 天前`;
	}

	const ACTION_LABEL: Record<string, string> = {
		login: "登录了站点",
		logout: "退出了登录",
		view: "浏览了页面",
		profile_update: "更新了个人资料",
		password_change: "修改了密码",
		user_create: "新建账号",
		user_update: "更新了账号",
		user_delete: "删除了账号",
		session_revoke: "撤销了会话"
	};

	function actionLabel(a: string): string {
		return ACTION_LABEL[a] ?? a;
	}
</script>

<Seo title="站点动态"
	description="站点实时动态与活跃度。"
	path="/pulse"
/>

<Container class="py-10">
	<PageHeader title="站点动态" description="谁在线、最近在干什么、这站有多热闹。" />

	<!-- 概览卡 -->
	<div class="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
		<div class="rounded-xl border border-border/60 bg-card p-4">
			<div class="flex items-center gap-2 text-sm text-muted-foreground"><Radio class="size-4 text-emerald-500" /> 当前在线</div>
			<p class="mt-2 font-heading text-2xl font-semibold tabular-nums">{online}</p>
			<p class="text-xs text-muted-foreground">判定窗口 {data.onlineWindowMin} 分钟内有心跳</p>
		</div>
		<div class="rounded-xl border border-border/60 bg-card p-4">
			<div class="flex items-center gap-2 text-sm text-muted-foreground"><Activity class="size-4 text-primary" /> 近 24 小时</div>
			<p class="mt-2 font-heading text-2xl font-semibold tabular-nums">{sum.today}</p>
			<p class="text-xs text-muted-foreground">次活动</p>
		</div>
		<div class="rounded-xl border border-border/60 bg-card p-4">
			<div class="flex items-center gap-2 text-sm text-muted-foreground"><Users class="size-4 text-sky-500" /> 24 小时内活跃</div>
			<p class="mt-2 font-heading text-2xl font-semibold tabular-nums">{sum.activeUsers24h}</p>
			<p class="text-xs text-muted-foreground">人（去重）</p>
		</div>
		<div class="rounded-xl border border-border/60 bg-card p-4">
			<div class="flex items-center gap-2 text-sm text-muted-foreground"><Flame class="size-4 text-amber-500" /> 近 30 天</div>
			<p class="mt-2 font-heading text-2xl font-semibold tabular-nums">{totalHeat}</p>
			<p class="text-xs text-muted-foreground">{activeDays}/{data.heat.length} 天有活动</p>
		</div>
	</div>

	<div class="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
		<!-- 热度 -->
		<section class="rounded-xl border border-border/60 bg-card p-5">
			<h2 class="flex items-center gap-2 font-heading text-lg font-medium"><Flame class="size-4 text-primary" /> 活跃热度</h2>
			<p class="mt-1 text-xs text-muted-foreground">近 30 天每日活动量。柱子越高那天越热闹。</p>
			<div class="mt-4 flex h-32 items-end gap-[3px]">
				{#each data.heat as h}
					<div class="group relative flex-1" title={h.date} >
						<div
							class="w-full rounded-sm transition-all"
							class:bg-primary={h.count > 0}
							class:bg-muted={h.count === 0}
							style="height:{Math.max(2, (h.count / maxHeat) * 100)}%"
						></div>
						<span
							class="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-popover px-1.5 py-0.5 text-[10px] text-popover-foreground shadow"
						>
							{h.date} · {h.count}
						</span>
					</div>
				{/each}
			</div>
			<p class="mt-2 text-xs text-muted-foreground">
				峰值 {maxHeat}（{data.heat.reduce((a, b) => (b.count > a.count ? b : a)).date}）
			</p>
		</section>

		<!-- 在线 -->
		<section class="rounded-xl border border-border/60 bg-card p-5">
			<h2 class="flex items-center gap-2 font-heading text-lg font-medium"><Users class="size-4 text-primary" /> 在线成员</h2>
			{#if data.online.length === 0}
				<p class="mt-3 text-sm text-muted-foreground">此刻没人在线。</p>
				<p class="mt-1 text-xs text-muted-foreground">打开页面 5 分钟内保持浏览，自己就会出现在列表里。</p>
			{:else}
				<ul class="mt-3 flex flex-col gap-2">
					{#each data.online as o}
						<li class="flex items-center gap-2">
							{#if o.avatar}
								<img src={o.avatar} alt="" class="size-7 rounded-full object-cover" />
							{:else}
								<div class="flex size-7 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">
									{o.displayName.slice(0, 1)}
								</div>
							{/if}
							<span class="min-w-0 flex-1 truncate text-sm">{o.displayName}</span>
							<Badge variant="outline" class="text-[10px]">{o.role}</Badge>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>

	<div class="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
		<!-- 动态流 -->
		<section class="rounded-xl border border-border/60 bg-card p-5">
			<h2 class="flex items-center gap-2 font-heading text-lg font-medium"><Activity class="size-4 text-primary" /> 最近动态</h2>
			<ul class="mt-3 flex flex-col divide-y divide-border/40">
				{#each data.feed as a}
					<li class="flex flex-wrap items-baseline gap-x-2 py-2 text-sm">
						<span class="font-medium">{a.username}</span>
						<span class="text-muted-foreground">{actionLabel(a.action)}</span>
						{#if a.target}<span class="truncate text-muted-foreground">· {a.target}</span>{/if}
						{#if a.detail}<span class="truncate text-xs text-muted-foreground">（{a.detail}）</span>{/if}
						<span class="ml-auto shrink-0 text-xs text-muted-foreground">{ago(a.createdAt)}</span>
					</li>
				{:else}
					<li class="py-6 text-center text-sm text-muted-foreground">还没有动态记录。逛一圈就有了。</li>
				{/each}
			</ul>
		</section>

		<div class="flex flex-col gap-5">
			<!-- 活跃榜 -->
			<section class="rounded-xl border border-border/60 bg-card p-5">
				<h2 class="font-heading text-lg font-medium">近 14 天活跃榜</h2>
				<ol class="mt-3 flex flex-col gap-2">
					{#each data.top as u, i}
						<li class="flex items-center gap-2 text-sm">
							<span class="w-4 text-xs text-muted-foreground">{i + 1}</span>
							<span class="min-w-0 flex-1 truncate">{u.displayName}</span>
							<span class="text-xs text-muted-foreground tabular-nums">{u.count} 次</span>
						</li>
					{:else}
						<li class="text-sm text-muted-foreground">暂时无人上榜。</li>
					{/each}
				</ol>
			</section>

			{#if data.storage}
				<section class="rounded-xl border border-border/60 bg-card p-5">
					<h2 class="flex items-center gap-2 font-heading text-lg font-medium"><HardDrive class="size-4 text-primary" /> 附件占用</h2>
					<ul class="mt-3 flex flex-col gap-2 text-sm">
						{#each data.storage as s}
							<li class="flex items-center gap-2">
								<span class="min-w-0 flex-1 truncate">{s.displayName}</span>
								<span class="text-xs text-muted-foreground tabular-nums">
									{formatBytes(s.usedBytes)}/{formatBytes(s.quotaBytes)}
								</span>
							</li>
						{/each}
					</ul>
					<a href="/admin/library" class="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline">
						存储空间管理 <ArrowRight class="size-3" />
					</a>
				</section>
			{/if}

			<a
				href="/changelog"
				class="rounded-xl border border-border/60 bg-card p-5 transition-colors hover:border-primary/40"
			>
				<h2 class="font-heading text-lg font-medium">项目开发进度</h2>
				<p class="mt-1 text-sm text-muted-foreground">看看各个项目走到哪一步了。</p>
				<span class="mt-2 inline-flex items-center gap-1 text-xs text-primary">
					更新日志 <ArrowRight class="size-3" />
				</span>
			</a>
		</div>
	</div>
</Container>
