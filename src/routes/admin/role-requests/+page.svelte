<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Check, X, ShieldPlus, AlertTriangle } from "@lucide/svelte";
	import { roleToLevel, ROLE_LABELS, LEVEL_LABELS, PROOF_TYPE_LABELS } from "$lib/permissions.js";
	import type { Role, Level } from "$lib/permissions.js";

	interface Req {
		id: string; username: string; fromRole: string; fromLevel: number;
		targetRole: string; targetLevel: number;
		realName: string; contact: string; proofType: string; proofRef: string;
		className: string; gradeName: string; reason: string; evidence: string;
		status: string; reviewer: string; reviewNote: string;
		createdAt: string; reviewedAt: string | null;
	}

	const { data }: { data: { user?: { username: string; role: string } | null } } = $props();

	let requests = $state<Req[]>([]);
	let loading = $state(true);
	let error = $state("");
	let filter = $state<"pending" | "all">("pending");
	let notes = $state<Record<string, string>>({});
	let busy = $state<Record<string, boolean>>({});

	// 审批人自己的等级：低于等于目标等级的申请，服务端会拒（「不得自行放权」）。
	// 前端把这一条提前显示，避免管理员点了才吃到 400 却不知为何。
	const myRole = $derived((data?.user?.role ?? null) as Role | null);
	const myLevel = $derived(roleToLevel(myRole));
	const canReview = $derived(myLevel !== null && myLevel >= 5);

	const label = (r: string) => ROLE_LABELS[r as Role] ?? r;
	const lvLabel = (n: number) => LEVEL_LABELS[n as Level] ?? `L${n}`;

	async function load() {
		loading = true;
		error = "";
		try {
			const res = await fetch(`/api/role-requests?scope=review&status=${filter}`);
			if (res.ok) {
				const d = await res.json();
				requests = d.requests ?? [];
			} else {
				const d = await res.json().catch(() => ({}));
				error = d.error || `加载失败（HTTP ${res.status}）`;
			}
		} catch { error = "网络错误"; }
		loading = false;
	}

	async function act(id: string, action: "approve" | "reject") {
		busy = { ...busy, [id]: true };
		error = "";
		try {
			const res = await fetch("/api/role-requests", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ id, action, note: notes[id] ?? "" })
			});
			const d = await res.json().catch(() => ({}));
			if (!res.ok) error = d.error || "操作失败";
			await load();
		} catch { error = "网络错误"; }
		busy = { ...busy, [id]: false };
	}

	// filter 变化时重取。**不要**再配一个 onMount(load)：$effect 会在挂载后
	// 立刻跑一次，两者叠加就是「开页发两次请求」——在真实后端上表现为
	// 首屏闪烁 + 无谓的重查（这个页面还会顺带被审计/活动流记两笔）。
	$effect(() => { filter; load(); });
</script>

<div class="mb-6 flex flex-wrap items-end justify-between gap-3">
	<div>
		<h1 class="font-heading text-2xl font-semibold">权限申请</h1>
		<p class="text-sm text-muted-foreground">
			审核用户提交的等级晋升申请。通过后<strong>立即改写该用户的角色</strong>（无需其重新登录）。
		</p>
	</div>
	<div class="flex items-center gap-2">
		<Button size="sm" variant={filter === "pending" ? "default" : "outline"} onclick={() => (filter = "pending")}>待审核</Button>
		<Button size="sm" variant={filter === "all" ? "default" : "outline"} onclick={() => (filter = "all")}>全部</Button>
	</div>
</div>

{#if !canReview}
	<p class="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700">
		你的等级（{myLevel === null ? "未识别" : lvLabel(myLevel)}）不具备审批权限（需 L5 及以上）。
	</p>
{/if}

{#if error}
	<p class="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
{/if}

{#if loading}
	<p class="text-muted-foreground">加载中...</p>
{:else if requests.length === 0}
	<div class="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
		{filter === "pending" ? "暂无待审核的权限申请" : "暂无权限申请记录"}
	</div>
{:else}
	<div class="max-w-3xl space-y-3">
		{#each requests as r (r.id)}
			{@const blocked = myLevel !== null && myLevel <= r.targetLevel}
			<div class="rounded-lg border p-4">
				<div class="flex flex-wrap items-center gap-2">
					<ShieldPlus class="size-4 shrink-0 text-primary" />
					<span class="font-medium">{r.username}</span>
					<span class="text-xs text-muted-foreground">
						{lvLabel(r.fromLevel)} {label(r.fromRole)} → <strong>{lvLabel(r.targetLevel)} {label(r.targetRole)}</strong>
					</span>
					{#if r.status === "pending"}<Badge variant="outline">待审核</Badge>{/if}
					{#if r.status === "approved"}<Badge>已通过</Badge>{/if}
					{#if r.status === "rejected"}<Badge variant="destructive">已驳回</Badge>{/if}
					{#if r.status === "cancelled"}<Badge variant="secondary">已撤回</Badge>{/if}
					<span class="ml-auto text-xs text-muted-foreground">提交 {new Date(r.createdAt).toLocaleString("zh-CN", { hour12: false })}</span>
				</div>

				<dl class="mt-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
					<div><dt class="inline text-muted-foreground">真实姓名：</dt><dd class="inline">{r.realName || "—"}</dd></div>
					<div><dt class="inline text-muted-foreground">联系方式：</dt><dd class="inline">{r.contact || "—"}</dd></div>
					<div class="sm:col-span-2">
						<dt class="inline text-muted-foreground">能力证明：</dt>
						<dd class="inline">
							{PROOF_TYPE_LABELS[r.proofType] ?? r.proofType ?? "—"}
							{#if r.proofRef}<span class="font-medium">　{r.proofRef}</span>{/if}
						</dd>
					</div>
					{#if r.className || r.gradeName}
						<div class="sm:col-span-2">
							<dt class="inline text-muted-foreground">班级/年级：</dt>
							<dd class="inline">{[r.gradeName, r.className].filter(Boolean).join(" · ") || "—"}</dd>
						</div>
					{/if}
				</dl>

				<p class="mt-2 rounded-md bg-muted/50 p-2 text-xs">{r.reason}</p>
				{#if r.evidence}
					<details class="mt-2">
						<summary class="cursor-pointer text-xs text-muted-foreground">补充材料</summary>
						<p class="mt-1 whitespace-pre-wrap text-xs">{r.evidence}</p>
					</details>
				{/if}

				{#if r.reviewNote}
					<p class="mt-2 text-xs">
						<span class="text-muted-foreground">审核意见（{r.reviewer || "—"}）：</span>{r.reviewNote}
					</p>
				{/if}

				{#if r.status === "pending"}
					{#if blocked}
						<p class="mt-3 flex items-center gap-1 text-xs text-amber-700">
							<AlertTriangle class="size-3.5" />
							你的等级（L{myLevel}）不高于目标等级（L{r.targetLevel}）—— 按「不得自行放权」规则无法审批，需更高等级管理员处理。
						</p>
					{:else if r.username === data?.user?.username}
						<p class="mt-3 flex items-center gap-1 text-xs text-amber-700">
							<AlertTriangle class="size-3.5" />不能审批自己的申请。
						</p>
					{:else}
						<div class="mt-3 flex flex-wrap items-center gap-2">
							<input bind:value={notes[r.id]} maxlength="500" placeholder="审核意见（选填，会展示给申请人）"
								class="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs outline-none focus:border-primary/60" />
							<Button size="sm" onclick={() => act(r.id, "approve")} disabled={busy[r.id]}>
								<Check class="h-3.5 w-3.5" /> 通过并升级
							</Button>
							<Button size="sm" variant="outline" onclick={() => act(r.id, "reject")} disabled={busy[r.id]}>
								<X class="h-3.5 w-3.5" /> 驳回
							</Button>
						</div>
					{/if}
				{/if}
			</div>
		{/each}
	</div>
{/if}
