<script lang="ts">
	import { onMount } from "svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Skeleton } from "$lib/components/ui/skeleton/index.js";
	import * as Select from "$lib/components/ui/select/index.js";
	import {
		Activity, Users, RefreshCw, Search, LogIn, LogOut, Eye, UserCog, UserPlus,
		UserMinus, KeyRound, ShieldOff, Pencil, Circle
	} from "@lucide/svelte";
	import { ROLE_LABELS } from "$lib/permissions.js";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	interface Item {
		id: number; username: string; action: string; target: string;
		detail: string; ip: string; created_at: string;
	}
	interface Online {
		username: string; displayName: string; role: string; avatar: string;
		lastSeenAt: string; sessionCount: number; ips: string[];
	}

	let items = $state<Item[]>(data.items as Item[]);
	let online = $state<Online[]>(data.online as Online[]);
	let summary = $state(data.summary);
	let total = $state(data.total);
	let loading = $state(false);

	let filterUser = $state("");
	let filterAction = $state("all");
	let query = $state("");

	const ACTION_META: Record<string, { label: string; icon: any; tone: string }> = {
		login: { label: "登录", icon: LogIn, tone: "text-emerald-400" },
		logout: { label: "登出", icon: LogOut, tone: "text-muted-foreground" },
		view: { label: "浏览", icon: Eye, tone: "text-sky-400" },
		profile_update: { label: "资料更新", icon: Pencil, tone: "text-violet-400" },
		user_create: { label: "新建用户", icon: UserPlus, tone: "text-emerald-400" },
		user_update: { label: "修改用户", icon: UserCog, tone: "text-amber-400" },
		user_delete: { label: "删除用户", icon: UserMinus, tone: "text-destructive" },
		password_change: { label: "修改密码", icon: KeyRound, tone: "text-amber-400" },
		session_revoke: { label: "吊销会话", icon: ShieldOff, tone: "text-destructive" }
	};
	function meta(a: string) {
		return ACTION_META[a] || { label: a, icon: Activity, tone: "text-muted-foreground" };
	}

	async function load() {
		loading = true;
		try {
			const p = new URLSearchParams({ limit: "60" });
			if (filterUser.trim()) p.set("username", filterUser.trim());
			if (filterAction !== "all") p.set("action", filterAction);
			const res = await fetch(`/api/activities?${p}`);
			if (res.ok) {
				const d = await res.json();
				items = d.items || [];
				total = d.total || 0;
				summary = d.summary;
				online = d.online || [];
			}
		} catch { /* 静默 */ }
		loading = false;
	}

	// 轻量实时：20s 轮询一次在线与活动（页面不可见时跳过，省开销）
	onMount(() => {
		const id = setInterval(() => {
			if (document.visibilityState === "visible") load();
		}, 20000);
		return () => clearInterval(id);
	});

	const visible = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return items;
		return items.filter((i) =>
			[i.username, i.target, i.detail, i.action].some((v) => (v || "").toLowerCase().includes(q))
		);
	});

	function relTime(iso: string): string {
		const t = Date.parse(iso);
		if (!Number.isFinite(t)) return "—";
		const s = Math.max(0, (Date.now() - t) / 1000);
		if (s < 60) return "刚刚";
		if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
		if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
		if (s < 604800) return `${Math.floor(s / 86400)} 天前`;
		return iso.slice(0, 10);
	}
</script>

<svelte:head>
	<title>活动中心 | Stelarith</title>
</svelte:head>

<div class="mb-6 flex flex-wrap items-end justify-between gap-3">
	<div>
		<h1 class="font-heading text-2xl font-semibold tracking-tight">活动中心</h1>
		<p class="text-sm text-muted-foreground">多用户活动流与实时在线状态</p>
	</div>
	<Button variant="outline" onclick={load} disabled={loading}>
		<RefreshCw class="mr-2 size-4 {loading ? 'animate-spin' : ''}" /> 刷新
	</Button>
</div>

<!-- 概览 -->
<div class="mb-6 grid gap-3 sm:grid-cols-3">
	<div class="rounded-xl border border-border/60 bg-card p-4">
		<p class="text-xs text-muted-foreground">当前在线</p>
		<p class="mt-1 font-heading text-2xl font-semibold tracking-tight">{online.length}</p>
	</div>
	<div class="rounded-xl border border-border/60 bg-card p-4">
		<p class="text-xs text-muted-foreground">近 24 小时活动</p>
		<p class="mt-1 font-heading text-2xl font-semibold tracking-tight">{summary?.today ?? 0}</p>
	</div>
	<div class="rounded-xl border border-border/60 bg-card p-4">
		<p class="text-xs text-muted-foreground">累计活动</p>
		<p class="mt-1 font-heading text-2xl font-semibold tracking-tight">{summary?.total ?? 0}</p>
	</div>
</div>

<!-- 在线用户 -->
<div class="mb-6 rounded-xl border border-border/60 bg-card p-4">
	<h2 class="mb-3 flex items-center gap-2 font-heading text-sm font-medium">
		<Users class="size-4 text-primary" /> 在线用户
		<span class="text-xs text-muted-foreground">· 多端在线时按账号聚合</span>
	</h2>
	{#if online.length === 0}
		<p class="text-sm text-muted-foreground">暂无用户在线</p>
	{:else}
		<div class="flex flex-wrap gap-2">
			{#each online as u (u.username)}
				<div class="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
					<span class="relative flex size-7 items-center justify-center rounded-full bg-primary/15 text-xs font-medium text-primary">
						{u.displayName?.slice(0, 1) || u.username.slice(0, 1)}
						<Circle class="absolute -bottom-0.5 -right-0.5 size-2.5 fill-emerald-400 text-emerald-400" />
					</span>
					<div class="flex flex-col leading-tight">
						<span class="text-xs font-medium">{u.displayName || u.username}</span>
						<span class="text-[11px] text-muted-foreground">
							{ROLE_LABELS[u.role as keyof typeof ROLE_LABELS] || u.role}
							{#if u.sessionCount > 1} · {u.sessionCount} 端{/if}
						</span>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- 过滤 -->
<div class="mb-4 flex flex-wrap items-center gap-2">
	<div class="relative min-w-[200px] flex-1">
		<Search class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
		<Input bind:value={query} placeholder="在当前列表中搜索…" class="pl-9" />
	</div>
	<Input bind:value={filterUser} placeholder="按用户名过滤" class="max-w-[180px]" />
	<div class="w-[150px]">
		<Select.Root type="single" bind:value={filterAction}>
			<Select.Trigger class="w-full">
				{filterAction === "all" ? "全部动作" : (meta(filterAction).label)}
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="all" label="全部动作" />
				<Select.Item value="login" label="登录" />
				<Select.Item value="logout" label="登出" />
				<Select.Item value="view" label="浏览" />
				<Select.Item value="profile_update" label="资料更新" />
				<Select.Item value="user_create" label="新建用户" />
				<Select.Item value="user_update" label="修改用户" />
				<Select.Item value="user_delete" label="删除用户" />
				<Select.Item value="password_change" label="修改密码" />
				<Select.Item value="session_revoke" label="吊销会话" />
			</Select.Content>
		</Select.Root>
	</div>
	<Button variant="outline" onclick={load}>应用筛选</Button>
</div>

<!-- 活动流 -->
{#if loading}
	<div class="space-y-2">
		{#each Array(5) as _, i (i)}
			<div class="flex items-center gap-3 rounded-lg border p-4">
				<Skeleton class="size-8 rounded-full" />
				<div class="flex-1 space-y-2"><Skeleton class="h-4 w-1/3" /><Skeleton class="h-3 w-1/2" /></div>
				<Skeleton class="h-3 w-16" />
			</div>
		{/each}
	</div>
{:else}
	<div class="overflow-hidden rounded-xl border border-border/60">
		{#each visible as it (it.id)}
			{@const m = meta(it.action)}
			<div class="flex items-center gap-3 border-b border-border/40 px-4 py-3 last:border-b-0 hover:bg-muted/30">
				<span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted/50">
					<m.icon class="size-4 {m.tone}" />
				</span>
				<div class="min-w-0 flex-1">
					<div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
						<span class="text-sm font-medium">{it.username || "系统"}</span>
						<Badge variant="outline" class="text-[11px]">{m.label}</Badge>
						{#if it.target}<span class="truncate text-xs text-muted-foreground">{it.target}</span>{/if}
					</div>
					{#if it.detail}
						<p class="mt-0.5 truncate text-xs text-muted-foreground">{it.detail}</p>
					{/if}
				</div>
				<div class="shrink-0 text-right">
					<p class="text-xs text-muted-foreground">{relTime(it.created_at)}</p>
					{#if it.ip}<p class="text-[11px] text-muted-foreground/70">{it.ip}</p>{/if}
				</div>
			</div>
		{:else}
			<div class="px-4 py-16 text-center text-sm text-muted-foreground">暂无活动记录</div>
		{/each}
	</div>
	<p class="mt-3 text-xs text-muted-foreground">共 {total} 条记录，当前显示 {visible.length} 条</p>
{/if}
