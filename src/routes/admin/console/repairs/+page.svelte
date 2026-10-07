<script lang="ts">
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Wrench, Plus, RefreshCw, Trash2 } from "@lucide/svelte";
	import type { PageData } from "./$types";

	// 设备报修台账（2026-10-08）。真源在云端 repairs.json（cloud-ws a5266cf），
	// 本页只做展示与操作，不另存一份——否则两边会各记一套账。
	//
	// ⚠️ 失败降级是第一优先级：生产 8788 是独立副本，可能还没同步 a5266cf。
	// 云端返回 404 时代理回 enabled:false，本页显示「通道未启用」的说明而不是白屏/报错。
	type Ticket = {
		id: string;
		uid: string;
		reporter: string;
		symptom: string;
		severity: string;
		status: string;
		at: string;
		note?: string | null;
		closedAt?: string | null;
	};

	let { data }: { data: PageData } = $props();
	const canManage = $derived(data.can.manage);

	let tickets = $state<Ticket[]>([]);
	let enabled = $state(false);
	let reason = $state("");
	let loading = $state(false);
	let filter = $state("");   // 状态过滤：""=全部
	let busy = $state(false);

	// 建档表单
	let showForm = $state(false);
	let fUid = $state("");
	let fSymptom = $state("");
	let fSeverity = $state("normal");
	let fReporter = $state("");

	// 状态备注编辑
	let noteId = $state("");
	let noteDraft = $state("");

	const SEV: Record<string, { label: string; cls: string }> = {
		low: { label: "低", cls: "secondary" },
		normal: { label: "一般", cls: "outline" },
		urgent: { label: "紧急", cls: "destructive" }
	};
	const STATUS: Record<string, { label: string; cls: string }> = {
		open: { label: "待处理", cls: "destructive" },
		processing: { label: "处理中", cls: "outline" },
		fixed: { label: "已修复", cls: "default" },
		closed: { label: "已关闭", cls: "secondary" }
	};
	// 状态流转：只能往前走，不能跳级回退（避免「已关闭」被改回「待处理」抹掉处理痕迹）
	const NEXT: Record<string, string[]> = {
		open: ["processing", "closed"],
		processing: ["fixed", "closed"],
		fixed: ["closed", "open"],
		closed: ["open"]
	};

	function fmtAt(s?: string | null): string {
		if (!s) return "—";
		const d = new Date(s);
		if (Number.isNaN(d.getTime())) return s;
		const p = (n: number) => String(n).padStart(2, "0");
		return `${d.getMonth() + 1}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
	}

	async function load() {
		if (!enabled) reason = "云端地址未配置";
		loading = true;
		try {
			const r = await (await fetch("/api/console/control/repairs")).json();
			if (!r.enabled) {
				enabled = false;
				reason = String(r.reason || r.error || "云端未启用报修端点");
				tickets = [];
				return;
			}
			enabled = true;
			reason = "";
			tickets = Array.isArray(r.items) ? r.items.map((t: Record<string, unknown>) => ({
				id: String(t.id ?? ""), uid: String(t.uid ?? ""), reporter: String(t.reporter ?? ""),
				symptom: String(t.symptom ?? ""), severity: String(t.severity ?? "normal"),
				status: String(t.status ?? "open"), at: String(t.at ?? ""),
				note: (t.note as string | null | undefined) ?? null,
				closedAt: (t.closedAt as string | null | undefined) ?? null
			})) : [];
		} catch {
			enabled = false;
			reason = "请求失败（网络异常）";
			tickets = [];
		} finally {
			loading = false;
		}
	}

	const visible = $derived(filter ? tickets.filter((t) => t.status === filter) : tickets);
	const openCount = $derived(tickets.filter((t) => t.status === "open" || t.status === "processing").length);

	async function create() {
		const uid = fUid.trim();
		const symptom = fSymptom.trim();
		if (!uid || !symptom) {
			toast.error("设备 uid 与故障描述都不能为空");
			return;
		}
		if (symptom.length > 200) {
			toast.error("症状描述过长（≤200 字）");
			return;
		}
		busy = true;
		try {
			const r = await (await fetch("/api/console/control/repairs", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					uid, symptom, severity: fSeverity,
					...(fReporter.trim() ? { reporter: fReporter.trim() } : {})
				})
			})).json();
			if (r.ok) {
				toast.success(`已建单 ${r.ticket?.id ?? ""}`);
				fUid = ""; fSymptom = ""; fSeverity = "normal"; fReporter = "";
				showForm = false;
				await load();
			} else {
				toast.error(String(r.error || r.reason || "建单失败"));
				if (r.enabled === false) enabled = false;
			}
		} catch {
			toast.error("请求失败（网络异常）");
		} finally {
			busy = false;
		}
	}

	async function setStatus(id: string, status: string) {
		busy = true;
		try {
			const r = await (await fetch(`/api/console/control/repairs/${encodeURIComponent(id)}`, {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ status })
			})).json();
			if (r.ok) {
				toast.success(`${STATUS[status]?.label ?? status} · ${id}`);
				await load();
			} else {
				toast.error(String(r.error || "操作失败"));
				if (r.enabled === false) enabled = false;
			}
		} catch {
			toast.error("请求失败（网络异常）");
		} finally {
			busy = false;
		}
	}

	async function saveNote(id: string) {
		const note = noteDraft.trim();
		busy = true;
		try {
			const r = await (await fetch(`/api/console/control/repairs/${encodeURIComponent(id)}`, {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ note: note.slice(0, 500) })
			})).json();
			if (r.ok) {
				toast.success("备注已保存");
				noteId = ""; noteDraft = "";
				await load();
			} else {
				toast.error(String(r.error || "保存失败"));
			}
		} catch {
			toast.error("请求失败（网络异常）");
		} finally {
			busy = false;
		}
	}

	async function del(id: string) {
		busy = true;
		try {
			const r = await (await fetch(`/api/console/control/repairs/${encodeURIComponent(id)}`, {
				method: "DELETE"
			})).json();
			if (r.ok) {
				toast.success(`已删除 ${id}`);
				await load();
			} else {
				toast.error(String(r.error || "删除失败"));
			}
		} catch {
			toast.error("请求失败（网络异常）");
		} finally {
			busy = false;
		}
	}

	onMount(() => { void load(); });
</script>

<svelte:head>
	<title>设备报修 · 集控面板 | Stelarith</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-5xl p-4 md:p-6">
	<div class="mb-5 flex flex-wrap items-center gap-3">
		<div class="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary"><Wrench class="size-5" /></div>
		<div class="min-w-0 flex-1">
			<h1 class="font-heading text-lg font-semibold">设备报修</h1>
			<p class="text-xs text-muted-foreground">
				故障工单台账，真源在云端 <code class="rounded bg-muted px-1">repairs.json</code>；老师建单、逐单流转处理。
			</p>
		</div>
		{#if canManage && enabled}
			<Button size="sm" variant="outline" disabled={busy} onclick={() => (showForm = !showForm)}>
				<Plus class="mr-1.5 size-3.5" /> 新建报修单
			</Button>
		{/if}
		<Button size="sm" variant="outline" disabled={loading} onclick={load}><RefreshCw class="mr-1.5 size-3.5" /> 刷新</Button>
	</div>

	{#if !enabled}
		<div class="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
			<h2 class="mb-1 text-sm font-semibold text-amber-600 dark:text-amber-400">设备报修通道未启用</h2>
			<p class="mb-2 text-xs text-muted-foreground">
				本页数据存放在云端（cloud-ws），需要云端部署 <code class="rounded bg-muted px-1">a5266cf</code> 起才有 <code class="rounded bg-muted px-1">/api/repairs</code> 端点。
			</p>
			<p class="text-xs text-muted-foreground">当前状态：<span class="font-medium">{reason}</span></p>
			<p class="mt-3 text-xs text-muted-foreground">
				同步云端副本并重启后，本页会自动可用，无需改动站点代码。
			</p>
		</div>
	{:else}
		<!-- 新建表单 -->
		{#if showForm}
			<div class="mb-4 rounded-xl border border-border/60 bg-card p-4 shadow-sm">
				<div class="mb-3 text-sm font-semibold">新建报修单</div>
				<div class="grid gap-3 sm:grid-cols-2">
					<input bind:value={fUid} placeholder="设备 uid（如 class_xlzx_2028_08）" maxlength="128"
						class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring" />
					<input bind:value={fReporter} placeholder="报修人（可选，默认 admin）" maxlength="64"
						class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring" />
				</div>
				<textarea bind:value={fSymptom} rows="2" maxlength="200" placeholder="故障现象（≤200 字）"
					class="mt-3 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"></textarea>
				<div class="mt-3 flex flex-wrap items-center gap-2">
					<label class="flex items-center gap-1.5 text-xs text-muted-foreground">
						严重度
						<select bind:value={fSeverity} class="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring">
							<option value="low">低</option>
							<option value="normal">一般</option>
							<option value="urgent">紧急</option>
						</select>
					</label>
					<Button size="sm" disabled={busy} onclick={create}>{busy ? "提交中…" : "提交"}</Button>
					<Button size="sm" variant="ghost" disabled={busy} onclick={() => (showForm = false)}>取消</Button>
					<span class="text-xs text-muted-foreground">{fSymptom.length}/200</span>
				</div>
			</div>
		{/if}

		<div class="mb-3 flex flex-wrap items-center gap-2 text-xs">
			<select bind:value={filter} class="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring">
				<option value="">全部状态（{tickets.length}）</option>
				<option value="open">待处理</option>
				<option value="processing">处理中</option>
				<option value="fixed">已修复</option>
				<option value="closed">已关闭</option>
			</select>
			<Badge variant={openCount > 0 ? "destructive" : "secondary"} class="text-xs">待处理 {openCount}</Badge>
		</div>

		{#if loading}
			<p class="rounded-xl border border-border/60 bg-card p-5 text-center text-xs text-muted-foreground">加载中…</p>
		{:else if visible.length === 0}
			<p class="rounded-xl border border-border/60 bg-card p-8 text-center text-xs text-muted-foreground">
				{tickets.length === 0 ? "还没有报修单。" : "该状态下没有工单。"}
			</p>
		{:else}
			<div class="space-y-2.5">
				{#each visible as t (t.id)}
					<div class="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
						<div class="flex flex-wrap items-start gap-2">
							<Badge variant={STATUS[t.status]?.cls === "default" ? "default" : STATUS[t.status]?.cls === "destructive" ? "destructive" : STATUS[t.status]?.cls === "outline" ? "outline" : "secondary"} class="text-xs">
								{STATUS[t.status]?.label ?? t.status}
							</Badge>
							<Badge variant={SEV[t.severity]?.cls === "destructive" ? "destructive" : SEV[t.severity]?.cls === "outline" ? "outline" : "secondary"} class="text-xs">
								{SEV[t.severity]?.label ?? t.severity}
							</Badge>
							<span class="min-w-0 flex-1 break-all font-mono text-xs text-muted-foreground">{t.id}</span>
							<span class="text-xs text-muted-foreground">{fmtAt(t.at)}</span>
						</div>
						<p class="mt-2 text-sm">{t.symptom}</p>
						<div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
							<span>设备 <code class="rounded bg-muted px-1 font-mono">{t.uid}</code></span>
							<span>报修人 {t.reporter}</span>
							{#if t.closedAt}<span>关闭于 {fmtAt(t.closedAt)}</span>{/if}
						</div>

						{#if t.note}
							<p class="mt-2 rounded-md bg-muted/60 px-2.5 py-1.5 text-xs">
								<span class="text-muted-foreground">备注：</span>{t.note}
							</p>
						{/if}

						{#if canManage}
							{#if noteId === t.id}
								<div class="mt-2.5 flex items-center gap-2">
									<input bind:value={noteDraft} maxlength="500" placeholder="处理备注（≤500 字）"
										class="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring" />
									<Button size="sm" disabled={busy} onclick={() => saveNote(t.id)}>{busy ? "…" : "保存"}</Button>
									<Button size="sm" variant="ghost" disabled={busy} onclick={() => (noteId = "")}>取消</Button>
								</div>
							{:else}
								<div class="mt-2.5 flex flex-wrap items-center gap-1.5">
									{#each NEXT[t.status] ?? [] as ns (ns)}
										<Button size="sm" variant="outline" disabled={busy} onclick={() => setStatus(t.id, ns)}>
											转为{STATUS[ns]?.label ?? ns}
										</Button>
									{/each}
									<Button size="sm" variant="ghost" disabled={busy} onclick={() => { noteId = t.id; noteDraft = t.note ?? ""; }}>
										备注
									</Button>
									<Button size="sm" variant="ghost" class="ml-auto text-destructive" disabled={busy} onclick={() => del(t.id)}>
										<Trash2 class="mr-1 size-3.5" /> 删除
									</Button>
								</div>
							{/if}
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>
