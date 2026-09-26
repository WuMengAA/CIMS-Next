<script lang="ts">
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Inbox, RefreshCw } from "@lucide/svelte";
	import type { PageData } from "./$types";

	// 执行回执（Svelte 版 · 2026-09-26 从原生面板迁移）。
	// ① 通知回执「谁看了」：选一条类型化通知 → 逐台送达/回复；
	// ② 设备执行流水：被控端「做完一件事」的上报（control 档可见）。
	let { data }: { data: PageData } = $props();

	type Notice = { id: string|number; title: string; at: string };
	type Delivery = { uid: string; state: string; reply?: string; action_result?: string; at?: string; updated_at?: string };
	type Event = { created_at?: string; uid: string; event: string; ok: boolean; detail?: string };

	let notices = $state<Notice[]>([]);
	let selected = $state("");
	let deliveries = $state<Delivery[]>([]);
	let dvNotice = $state<Notice | null>(null);
	let dvErr = $state("");
	let events = $state<Event[]>([]);
	let evStats = $state<{ total: number; ok: number; failed: number } | null>(null);

	const EV_LABEL: Record<string, string> = {
		watchdog_crash: "看门狗 · 崩溃重启", watchdog_hang: "看门狗 · 卡死重启",
		update_applied: "客户端自更新", screenshot_uploaded: "截屏上报",
		notice_ack: "通知回执", notice_reply: "回复通知", file_delivered: "文件送达",
		file_failed: "文件送达失败", command_ok: "指令执行成功", command_fail: "指令执行失败",
	};

	function stateInfo(st: string): { cls: string; label: string } {
		const map: Record<string, [string, string]> = {
			pending: ["warn", "待送达"], delivered: ["", "已送达"], read: ["ok", "已读"],
			replied: ["accent", "已回复"], acked_failed: ["err", "失败"],
		};
		const [cls, label] = map[st] || ["", st || "—"];
		return { cls, label };
	}

	function badgeVariant(kind: string): "default" | "secondary" | "outline" | "destructive" {
		if (kind === "ok" || kind === "accent") return "default";
		if (kind === "warn") return "outline";
		if (kind === "err") return "destructive";
		return "secondary";
	}

	async function loadNotices() {
		try {
			const r = await (await fetch("/api/console/ext/notices")).json();
			notices = Array.isArray(r) ? r.map((n: Record<string, unknown>) => ({ id: n.id ?? "", title: String(n.title ?? ""), at: String(n.at ?? "") })) : [];
		} catch {
			notices = [];
		}
	}

	async function loadDeliveries() {
		if (!selected) { deliveries = []; dvNotice = null; return; }
		try {
			const r = await (await fetch(`/api/console/ext/notice-deliveries?notice=${encodeURIComponent(selected)}`)).json();
			dvNotice = r?.notice ? { id: r.notice.id ?? "", title: String(r.notice.title ?? ""), at: String(r.notice.at ?? "") } : null;
			deliveries = Array.isArray(r?.deliveries) ? r.deliveries.map((d: Record<string, unknown>) => ({ uid: String(d.uid ?? ""), state: String(d.state ?? ""), reply: d.reply ? String(d.reply) : undefined, action_result: d.action_result ? String(d.action_result) : undefined, at: d.at ? String(d.at) : undefined, updated_at: d.updated_at ? String(d.updated_at) : undefined })) : [];
			dvErr = "";
		} catch (e) {
			deliveries = []; dvNotice = null; dvErr = (e as Error)?.message || "查询失败";
		}
	}

	async function loadEvents() {
		if (!data.can.control) return;
		try {
			const r = await (await fetch("/api/console/ext/events")).json();
			events = Array.isArray(r?.events) ? r.events.map((e: Record<string, unknown>) => ({ created_at: e.created_at ? String(e.created_at) : undefined, uid: String(e.uid ?? ""), event: String(e.event ?? ""), ok: !!e.ok, detail: e.detail ? String(e.detail) : undefined })) : [];
			evStats = r?.stats && typeof r.stats === "object" ? { total: Number(r.stats.total ?? 0), ok: Number(r.stats.ok ?? 0), failed: Number(r.stats.failed ?? 0) } : null;
		} catch {
			events = []; evStats = null;
		}
	}

	onMount(() => {
		loadNotices();
		loadEvents();
	});

	const repliedCount = $derived(deliveries.filter((d) => d.reply || d.state === "replied").length);
	const readCount = $derived(deliveries.filter((d) => d.state === "read").length);
	const pendingCount = $derived(deliveries.filter((d) => d.state === "pending").length);
	const failCount = $derived(deliveries.filter((d) => d.state === "acked_failed").length);
</script>
<svelte:head>
	<title>执行回执 · 集控面板 | Stelarith</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-5xl p-4 md:p-6">
	<div class="mb-5 flex items-center gap-3">
		<div class="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary"><Inbox class="size-5" /></div>
		<div>
			<h1 class="font-heading text-lg font-semibold">执行回执</h1>
			<p class="text-xs text-muted-foreground">通知回执「谁看了」+ 设备执行流水「做完没有」，被控端上报与回复原样展示。</p>
		</div>
	</div>

	<div class="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
		<h2 class="mb-3 text-sm font-semibold">通知回执 · 谁看了</h2>
		<p class="mb-3 text-xs text-muted-foreground">选一条通知，看每台设备的送达状态与回复内容（老师回复的话会原样显示）。</p>
		<div class="mb-3 flex items-center gap-2">
			<select bind:value={selected} onchange={loadDeliveries} class="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring">
				<option value="">— 选择一条历史通知 —</option>
				{#each notices as n (n.id)}<option value={n.id}>{n.title}（{n.at}）</option>{/each}
			</select>
			<Button variant="outline" size="sm" onclick={loadDeliveries}><RefreshCw class="mr-1.5 size-3.5" /> 刷新</Button>
		</div>
		{#if !selected}
			<p class="text-xs text-muted-foreground">从下拉里挑一条类型化通知（弹窗/全屏/需确认）查看逐台回执。</p>
		{:else if dvErr}
			<p class="text-xs text-destructive">{dvErr}</p>
		{:else if dvNotice}
			<div class="mb-3 flex flex-wrap gap-2 text-xs">
				<span>共 <b>{deliveries.length}</b> 台</span>
				<Badge variant="default">已读 {readCount}</Badge>
				<Badge variant="default">已回复 {repliedCount}</Badge>
				<Badge variant="outline">待送达 {pendingCount}</Badge>
				<Badge variant="destructive">失败 {failCount}</Badge>
			</div>
			{#if !deliveries.length}
				<p class="py-6 text-center text-xs text-muted-foreground">该通知尚无逐台回执（类型化通知才有）</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-sm">
						<thead><tr class="border-b text-left text-xs text-muted-foreground"><th class="py-2 pr-3 font-medium">设备</th><th class="py-2 pr-3 font-medium">状态</th><th class="py-2 pr-3 font-medium">回复内容</th><th class="py-2 font-medium">时间</th></tr></thead>
						<tbody>
							{#each deliveries as d (d.uid + d.at)}
								<tr class="border-b">
									<td class="py-2 pr-3 text-muted-foreground">{d.uid || "—"}</td>
									<td class="py-2 pr-3"><Badge variant={badgeVariant(stateInfo(d.state).cls)}>{stateInfo(d.state).label}</Badge></td>
									<td class="py-2 pr-3">
										{#if d.reply}"{d.reply}"{:else if d.action_result}"{d.action_result}"（预设）{:else if d.state === "replied"}已回复（内容未回传）{:else}<span class="text-muted-foreground">—</span>{/if}
									</td>
									<td class="py-2 pr-3 text-xs text-muted-foreground">{d.at || d.updated_at || "—"}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		{:else}
			<p class="text-xs text-muted-foreground">该通知查不到回执明细（不存在或无权限）。</p>
		{/if}
	</div>

	<div class="mt-5 rounded-xl border border-border/60 bg-card p-5 shadow-sm">
		<h2 class="mb-3 text-sm font-semibold">设备执行流水 · 最近动作</h2>
		{#if !data.can.control}
			<p class="text-xs text-muted-foreground">需要「设备控制」权限才能查看（老师账号看不到任何设备动作）。</p>
		{:else}
			{#if evStats}<p class="mb-2 text-xs text-muted-foreground">24 小时内 <b>{evStats.total}</b> 次动作，成功 <Badge variant="default">{evStats.ok}</Badge>、失败 <Badge variant="destructive">{evStats.failed}</Badge>。</p>{/if}
			{#if !events.length}
				<p class="py-6 text-center text-xs text-muted-foreground">还没有执行回执上报（被控端升级后开始产生）</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-sm">
						<thead><tr class="border-b text-left text-xs text-muted-foreground"><th class="py-2 pr-3 font-medium">时间</th><th class="py-2 pr-3 font-medium">设备</th><th class="py-2 pr-3 font-medium">动作</th><th class="py-2 pr-3 font-medium">结果</th><th class="py-2 font-medium">说明</th></tr></thead>
						<tbody>
							{#each events as e (e.created_at + e.uid + e.event)}
								<tr class="border-b">
									<td class="py-2 pr-3 text-xs text-muted-foreground">{e.created_at || "—"}</td>
									<td class="py-2 pr-3 text-xs text-muted-foreground">{e.uid || "—"}</td>
									<td class="py-2 pr-3">{EV_LABEL[e.event] || e.event || "—"}</td>
									<td class="py-2 pr-3"><Badge variant={e.ok ? "default" : "destructive"}>{e.ok ? "成功" : "失败"}</Badge></td>
									<td class="py-2 pr-3 text-xs text-muted-foreground">{(e.detail || "").slice(0, 120) || "—"}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
			<p class="mt-2 text-xs text-muted-foreground">每台设备只保留最近 200 条；全部按时间倒序，最多看 100 条。</p>
		{/if}
	</div>
</div>