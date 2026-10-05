<script lang="ts">
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { CalendarClock, RefreshCw, Loader2, Plus, CheckCircle2, XCircle, Undo2, Info } from "@lucide/svelte";

	// 自助切班（Svelte 版 · 从 CIMS /class/swap 迁移）。
	// 数据来源（照 CIMS 端点，不发明接口）：
	//   · 列表   GET  /api/console/cims/class/swap?status=&page=&size=
	//   · 创建   POST /api/console/cims/class/swap          {from_class_id,to_class_id,swap_type,reason,...}
	//   · 审批   POST /api/console/cims/class/swap/{id}/approve
	//   · 拒绝   POST /api/console/cims/class/swap/{id}/reject   {reason}
	//   · 取消   POST /api/console/cims/class/swap/{id}/cancel
	//   · 回滚   POST /api/console/cims/class/swap/{id}/rollback
	//   · 配置   GET  /api/console/cims/class/swap/config  {requires_approval,auto_rollback,max_pending_per_class}
	//   · 班级   GET  /api/class/list（自有真源，2026-10-04 收口）
	//   · acct （创建所需的账户上下文由代理服务端持有；本页只列/审批/取消/回滚）

	type ClassOpt = { class_id: string; name: string };
	type SwapItem = {
		id: string; from_class_id?: string; to_class_id?: string; swap_type?: string;
		reason?: string; status?: string; from_plan_before?: string; to_plan_before?: string;
		initiator_user_id?: string; initiator_role?: string; rejected_reason?: string;
		effective_start_at?: string; effective_end_at?: string; created_at?: string;
		executed_at?: string; rolled_back_at?: string;
	}

	let classes = $state<ClassOpt[]>([]);
	let items = $state<SwapItem[]>([]);
	let cfg = $state<{ requires_approval?: boolean; auto_rollback?: boolean; max_pending_per_class?: number }>({});
	let listErr = $state("");
	let loading = $state(true);
	let busyId = $state("");
	// 创建表单
	let showCreate = $state(false);
	let fFrom = $state("");
	let fTo = $state("");
	let fType = $state("swap");
	let fReason = $state("");
	let fStart = $state("");
	let fEnd = $state("");
	let creating = $state(false);

	const STATUS_LABEL: Record<string, string> = {
		pending: "待审批", approved: "已审批待执行", executing: "执行中", executed: "已执行",
		rejected: "已拒绝", cancelled: "已取消", rolled_back: "已回退", expired: "已过期",
	};
	const STATUS_VARIANT: Record<string, "default" | "outline" | "secondary" | "destructive" | undefined> = {
		pending: "secondary", approved: "outline", executing: "outline", executed: "default",
		rejected: "destructive", cancelled: "outline", rolled_back: "secondary", expired: "outline",
	};
	const TYPE_LABEL: Record<string, string> = { swap: "互换", single: "单切" };

	async function cimsCall(path: string, init?: RequestInit) {
		const res = await fetch(`/api/console/cims${path}`, {
			headers: { "Content-Type": "application/json" },
			...init
		});
		const d = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(d?.error || d?.message || `HTTP ${res.status}`);
		return d;
	}

	function clsName(cid?: string): string {
		if (!cid) return "—";
		return classes.find((c) => c.class_id === cid)?.name || cid;
	}

	async function loadClasses() {
		try {
			const res = await fetch("/api/class/list");
			const d = await res.json();
			if (!res.ok) throw new Error(d?.error || `HTTP ${res.status}`);
			classes = (Array.isArray(d?.classes) ? d.classes : [])
				.map((c: any) => ({ class_id: String(c.class_id ?? ""), name: String(c.name ?? c.class_id ?? "") }))
				.filter((c: ClassOpt) => Boolean(c.class_id));
		} catch (e) { classes = []; listErr = (e as Error).message || "班级列表加载失败"; }
	}

	async function loadList() {
		loading = true; listErr = "";
		try {
			const d = await cimsCall("/class/swap?page=1&size=50");
			items = Array.isArray(d?.items) ? d.items : [];
		} catch (e) { items = []; listErr = (e as Error).message || "切班列表加载失败"; }
		finally { loading = false; }
	}

	async function loadConfig() {
		try { cfg = (await cimsCall("/class/swap/config")) || {}; } catch { /* 配置不存在时用默认 */ }
	}

	async function act(id: string, action: "approve" | "cancel" | "rollback", label: string) {
		busyId = id;
		try {
			await cimsCall(`/class/swap/${encodeURIComponent(id)}/${action}`, { method: "POST", body: "{}" });
			toast.success(label + "成功");
			await loadList();
		} catch (e) { toast.error(label + "失败：" + ((e as Error).message || String(e))); }
		finally { busyId = ""; }
	}

	async function reject(id: string) {
		const reason = prompt("拒绝原因：");
		if (reason === null) return;
		busyId = id;
		try {
			await cimsCall(`/class/swap/${encodeURIComponent(id)}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
			toast.success("已拒绝");
			await loadList();
		} catch (e) { toast.error("拒绝失败：" + ((e as Error).message || String(e))); }
		finally { busyId = ""; }
	}

	async function create() {
		if (!fFrom || !fTo) { toast.error("请选择两个班级"); return; }
		if (fFrom === fTo) { toast.error("两个班级不能相同"); return; }
		creating = true;
		try {
			const payload: Record<string, unknown> = { from_class_id: fFrom, to_class_id: fTo, swap_type: fType, reason: fReason };
			if (fStart) payload.effective_start_at = fStart;
			if (fEnd) payload.effective_end_at = fEnd;
			await cimsCall("/class/swap", { method: "POST", body: JSON.stringify(payload) });
			toast.success("切班申请已提交");
			showCreate = false;
			fFrom = ""; fTo = ""; fType = "swap"; fReason = ""; fStart = ""; fEnd = "";
			await loadList();
		} catch (e) { toast.error("提交失败：" + ((e as Error).message || String(e))); }
		finally { creating = false; }
	}

	function fmt(iso?: string): string {
		if (!iso) return "—";
		const d = new Date(iso);
		return isNaN(d.getTime()) ? iso : d.toLocaleString("zh-CN", { hour12: false });
	}

	onMount(() => { loadClasses(); loadList(); loadConfig(); });
</script>
<svelte:head><title>自助切班 · 集控面板 | Stelarith</title><meta name="robots" content="noindex" /></svelte:head>

<div class="mx-auto max-w-5xl p-4 md:p-6">
	<!-- 2026-10-05：自助切班已停用（用户判定无价值）。页面保留仅作历史兜底，请改用「课表与调课」页。 -->
	<div class="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
		<Info class="mr-1 inline size-4 align-[-2px]" />
		<b>自助切班已停用</b>——该功能（两班课表方案互换）价值低。换课/调课请到「课表与调课」页（申请→审批→自动对调）。
	</div>
	<div class="mb-5 flex items-center justify-between">
		<div class="flex items-center gap-3">
			<div class="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary"><CalendarClock class="size-5" /></div>
			<div>
				<h1 class="font-heading text-lg font-semibold">自助切班（已停用）</h1>
				<p class="text-xs text-muted-foreground">互换 / 单切课表方案：申请 → {cfg.requires_approval ? "审批" : "直接执行"} → {cfg.auto_rollback ? "到期自动回退" : "手动回退"}。</p>
			</div>
		</div>
		<div class="flex items-center gap-2">
			<Button variant="outline" size="sm" onclick={loadList} disabled={loading}><RefreshCw class="mr-1 size-3.5 {loading ? "animate-spin" : ""}" />刷新</Button>
			<Button size="sm" onclick={() => (showCreate = !showCreate)}><Plus class="mr-1 size-3.5" />发起切班</Button>
		</div>
	</div>

	{#if showCreate}
	<section class="mb-5 rounded-xl border border-border/60 bg-card p-5">
		<h2 class="mb-3 text-sm font-semibold">发起切班</h2>
		<div class="grid gap-4 sm:grid-cols-2">
			<div class="grid gap-1.5"><Label for="f-type">类型</Label>
				<select id="f-type" bind:value={fType} class="h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none">
					<option value="swap">互换（两班对调课表）</option>
					<option value="single">单切（A 班切到 B 班方案）</option>
				</select></div>
			<div class="grid gap-1.5"><Label for="f-from">从班级</Label>
				<select id="f-from" bind:value={fFrom} class="h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none">
					<option value="">— 选择 —</option>
					{#each classes as c (c.class_id)}<option value={c.class_id}>{c.name}</option>{/each}
				</select></div>
			<div class="grid gap-1.5"><Label for="f-to">到班级</Label>
				<select id="f-to" bind:value={fTo} class="h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none">
					<option value="">— 选择 —</option>
					{#each classes as c (c.class_id)}<option value={c.class_id}>{c.name}</option>{/each}
				</select></div>
			<div class="grid gap-1.5"><Label for="f-reason">原因（保存留痕）</Label><Input id="f-reason" bind:value={fReason} placeholder="如：周五下午数学英语换课" /></div>
			<div class="grid gap-1.5"><Label for="f-start">生效时间</Label><Input id="f-start" bind:value={fStart} type="datetime-local" /></div>
			<div class="grid gap-1.5"><Label for="f-end">回退时间（留空=按配置）</Label><Input id="f-end" bind:value={fEnd} type="datetime-local" /></div>
		</div>
		<div class="mt-4 flex items-center gap-2">
			<Button onclick={create} disabled={creating || !fFrom || !fTo}><Loader2 class="mr-1 size-3.5 {creating ? "animate-spin" : ""}" />{creating ? "提交中…" : "提交"}</Button>
			{#if cfg.requires_approval}<Badge variant="outline" class="text-[11px]">需审批</Badge>{/if}
			{#if cfg.auto_rollback}<Badge variant="outline" class="text-[11px]">自动回退</Badge>{/if}
		</div>
	</section>
	{/if}

	{#if listErr}
		<div class="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-600 dark:text-red-400">{listErr}</div>
	{:else if loading && !items.length}
		<div class="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">加载中…</div>
	{:else if !items.length}
		<div class="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">还没有切班记录。</div>
	{:else}
	<div class="space-y-3">
		{#each items as it (it.id)}
			<div class="rounded-xl border border-border/60 bg-card p-4">
				<div class="flex flex-wrap items-center gap-2">
					<span class="font-medium">{clsName(it.from_class_id)}</span>
					<span class="text-muted-foreground">{it.swap_type === "single" ? "→" : "⇄"}</span>
					<span class="font-medium">{clsName(it.to_class_id)}</span>
					<Badge variant={STATUS_VARIANT[it.status || ""] || "outline"}>{STATUS_LABEL[it.status || ""] || it.status || "未知"}</Badge>
					{#if it.swap_type}<Badge variant="secondary" class="text-[10px]">{TYPE_LABEL[it.swap_type] || it.swap_type}</Badge>{/if}
				</div>
				{#if it.reason}<p class="mt-1.5 text-xs text-muted-foreground">{it.reason}</p>{/if}
				<div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
					<span>发起 {fmt(it.created_at)}</span>
					{#if it.effective_start_at}<span>生效 {fmt(it.effective_start_at)}</span>{/if}
					{#if it.effective_end_at}<span>回退 {fmt(it.effective_end_at)}</span>{/if}
					{#if it.status === "rejected" && it.rejected_reason}<span class="text-red-500">拒绝原因：{it.rejected_reason}</span>{/if}
				</div>
				<div class="mt-2 flex gap-2">
					{#if it.status === "pending"}
						<Button size="sm" class="h-7 text-xs" disabled={busyId === it.id} onclick={() => act(it.id, "approve", "审批")}><CheckCircle2 class="mr-1 size-3" />审批</Button>
						<Button size="sm" variant="outline" class="h-7 text-xs" disabled={busyId === it.id} onclick={() => reject(it.id)}><XCircle class="mr-1 size-3" />拒绝</Button>
					{/if}
					{#if it.status === "pending" || it.status === "approved"}
						<Button size="sm" variant="outline" class="h-7 text-xs" disabled={busyId === it.id} onclick={() => act(it.id, "cancel", "取消")}>取消</Button>
					{/if}
					{#if it.status === "executed" || it.status === "approved"}
						<Button size="sm" variant="outline" class="h-7 text-xs" disabled={busyId === it.id} onclick={() => act(it.id, "rollback", "回滚")}><Undo2 class="mr-1 size-3" />回滚</Button>
					{/if}
				</div>
			</div>
		{/each}
	</div>
	{/if}
</div>