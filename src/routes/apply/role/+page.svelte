<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import Container from "$lib/components/container.svelte";

	type Req = {
		id: string;
		targetRole: string;
		targetLevel: number;
		status: string;
		proofType: string;
		proofRef: string;
		reason: string;
		reviewer: string;
		reviewNote: string;
		createdAt: string;
		reviewedAt: string | null;
	};
	type Target = { role: string; label: string; level: number | null; levelLabel: string };
	type ProofType = { key: string; label: string; hint: string };

	const { data }: {
		data: {
			loggedIn: boolean;
			me: {
				username: string; role: string; roleLabel: string;
				level: number | null; levelLabel: string; levelDescription: string;
				className: string; gradeName: string;
			} | null;
			targets: Target[];
			proofTypes: ProofType[];
			requests: Req[];
		};
	} = $props();

	let targetRole = $state(data.targets[0]?.role ?? "");
	let realName = $state("");
	let contact = $state("");
	let proofType = $state(data.proofTypes[0]?.key ?? "");
	let proofRef = $state("");
	let className = $state(data.me?.className ?? "");
	let gradeName = $state(data.me?.gradeName ?? "");
	let reason = $state("");
	let evidence = $state("");

	let msg = $state("");
	let err = $state("");
	let submitting = $state(false);

	// 申请记录用本地 state 承载：**不要**直接改 `data`（$props() 传来的对象），
	// 那会反向写父级、并在 SPA 导航时留下不一致的缓存状态。
	let requests = $state<Req[]>(data.requests);

	/** 重新拉取「我的申请」——提交/撤回后调用，避免整页刷新丢掉已填的其他字段。 */
	async function refreshMine() {
		try {
			const r = await fetch("/api/role-requests?scope=mine");
			if (r.ok) {
				const j = await r.json();
				requests = j.requests ?? requests;
			}
		} catch { /* 刷新失败不影响主流程 */ }
	}

	const selectedProof = $derived(data.proofTypes.find((p) => p.key === proofType));
	const targetLabel = $derived(data.targets.find((t) => t.role === targetRole)?.label ?? "");

	const STATUS_MAP: Record<string, { label: string; cls: string }> = {
		pending: { label: "待审核", cls: "bg-amber-500/15 text-amber-600" },
		approved: { label: "已通过", cls: "bg-emerald-500/15 text-emerald-600" },
		rejected: { label: "已驳回", cls: "bg-destructive/15 text-destructive" },
		cancelled: { label: "已撤回", cls: "bg-muted text-muted-foreground" }
	};

	async function submit() {
		err = ""; msg = "";
		if (!targetRole) { err = "请选择要申请的目标角色"; return; }
		submitting = true;
		try {
			const res = await fetch("/api/role-requests", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					action: "submit", targetRole, realName, contact, proofType, proofRef,
					className, gradeName, reason, evidence
				})
			});
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				msg = "申请已提交。审核通过后角色立即生效（无需重新登录）。";
				realName = ""; contact = ""; proofRef = ""; reason = ""; evidence = "";
				await refreshMine();
			} else {
				err = d.error || "提交失败";
			}
		} catch { err = "网络错误"; }
		submitting = false;
	}

	async function cancel(id: string) {
		err = ""; msg = "";
		try {
			const res = await fetch("/api/role-requests", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "cancel", id })
			});
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				await refreshMine();
				msg = "已撤回该申请。";
			} else err = d.error || "撤回失败";
		} catch { err = "网络错误"; }
	}

	const fmt = (s: string | null) => (s ? new Date(s).toLocaleString("zh-CN", { hour12: false }) : "—");
</script>

<svelte:head><title>申请权限晋升 | Stelarith</title></svelte:head>

<Container>
	<div class="mx-auto max-w-3xl">
		<h1 class="font-heading text-2xl font-semibold tracking-tight">申请权限晋升</h1>
		<p class="mt-2 text-sm text-muted-foreground">
			等级只能<strong>逐级晋升</strong>：一次只能申请上一级，并需提供能力证明。由更高等级的管理员审核，
			通过后立即生效。
		</p>

		{#if !data.loggedIn}
			<p class="mt-6 text-sm text-muted-foreground">
				<a href="/admin/login" class="text-primary hover:underline">登录</a> 后可提交权限晋升申请。
			</p>
		{:else}
			<!-- 当前身份 -->
			<div class="mt-6 rounded-xl border border-border/60 bg-card p-5">
				<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
					<span class="font-medium">{data.me?.username}</span>
					<span class="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{data.me?.levelLabel}</span>
					<span class="text-xs text-muted-foreground">当前角色：{data.me?.roleLabel}</span>
				</div>
				<p class="mt-2 text-xs text-muted-foreground">{data.me?.levelDescription}</p>
			</div>

			{#if data.targets.length === 0}
				<div class="mt-4 rounded-xl border border-dashed border-border/60 p-5 text-sm text-muted-foreground">
					当前等级没有可申请的晋升目标（已是最高等级，或该等级不开放自助申请）。
					如需调整，请联系站长在「用户管理」中指派。
				</div>
			{:else}
				<!-- 申请表单 -->
				<div class="mt-4 flex flex-col gap-4 rounded-xl border border-border/60 bg-card p-5">
					<h2 class="font-heading text-base font-semibold">晋升申请</h2>

					<div>
						<label class="mb-1 block text-sm font-medium">申请角色 *</label>
						<div class="flex flex-wrap gap-2">
							{#each data.targets as t (t.role)}
								<button
									type="button"
									onclick={() => (targetRole = t.role)}
									class="rounded-lg border px-3 py-2 text-left text-sm transition-colors {targetRole === t.role
										? 'border-primary/60 bg-primary/10'
										: 'border-border/60 hover:border-primary/40'}"
								>
									<div class="font-medium">{t.label}</div>
									<div class="text-xs text-muted-foreground">{t.levelLabel}</div>
								</button>
							{/each}
						</div>
					</div>

					<div class="grid gap-4 sm:grid-cols-2">
						<div>
							<label class="mb-1 block text-sm font-medium">真实姓名 *</label>
							<input bind:value={realName} maxlength="40" placeholder="审核人需要知道在为谁背书"
								class="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary/60" />
						</div>
						<div>
							<label class="mb-1 block text-sm font-medium">联系方式 *</label>
							<input bind:value={contact} maxlength="120" placeholder="邮箱 / 手机 / 企业微信，便于回访"
								class="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary/60" />
						</div>
					</div>

					<div class="grid gap-4 sm:grid-cols-2">
						<div>
							<label class="mb-1 block text-sm font-medium">能力证明类型 *</label>
							<select bind:value={proofType}
								class="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary/60">
								{#each data.proofTypes as p (p.key)}
									<option value={p.key}>{p.label}</option>
								{/each}
							</select>
							{#if selectedProof}<p class="mt-1 text-xs text-muted-foreground">{selectedProof.hint}</p>{/if}
						</div>
						<div>
							<label class="mb-1 block text-sm font-medium">证明编号 / 引用 *</label>
							<input bind:value={proofRef} maxlength="200" placeholder="如工号、设备码、学校邮箱、推荐人用户名"
								class="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary/60" />
						</div>
					</div>

					<div class="grid gap-4 sm:grid-cols-2">
						<div>
							<label class="mb-1 block text-sm font-medium">班级</label>
							<input bind:value={className} maxlength="64" placeholder="如 2025届3班"
								class="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary/60" />
						</div>
						<div>
							<label class="mb-1 block text-sm font-medium">年级</label>
							<input bind:value={gradeName} maxlength="64" placeholder="如 2025级高一"
								class="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary/60" />
						</div>
					</div>

					<div>
						<label class="mb-1 block text-sm font-medium">申请理由 * <span class="text-xs font-normal text-muted-foreground">（至少 10 字）</span></label>
						<textarea bind:value={reason} rows={3} maxlength="2000"
							placeholder="说明你为什么需要这个等级、准备用它做什么"
							class="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60"></textarea>
					</div>

					<div>
						<label class="mb-1 block text-sm font-medium">补充材料</label>
						<textarea bind:value={evidence} rows={3} maxlength="2000"
							placeholder="可粘贴相关链接、处理过的工单、设备清单等（选填）"
							class="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60"></textarea>
					</div>

					{#if err}<p class="text-xs text-destructive">{err}</p>{/if}
					{#if msg}<p class="text-xs text-primary">{msg}</p>{/if}

					<div class="flex items-center justify-between">
						<p class="text-xs text-muted-foreground">提交后由更高等级管理员审核；同时只能有一张待审申请。</p>
						<Button onclick={submit} disabled={submitting}>
							{submitting ? "提交中…" : `申请 ${targetLabel}`}
						</Button>
					</div>
				</div>
			{/if}

			<!-- 历史申请 -->
			<h2 class="mt-8 font-heading text-base font-semibold">我的申请记录</h2>
			{#if data.requests.length === 0}
				<p class="mt-2 text-sm text-muted-foreground">暂无申请记录。</p>
			{:else}
				<div class="mt-3 flex flex-col gap-2">
					{#each data.requests as r (r.id)}
						{@const st = STATUS_MAP[r.status] ?? { label: r.status, cls: "bg-muted text-muted-foreground" }}
						<div class="rounded-lg border border-border/60 bg-card p-4">
							<div class="flex flex-wrap items-center gap-2">
								<span class="text-sm font-medium">→ L{r.targetLevel} {r.targetRole}</span>
								<span class="rounded-full px-2 py-0.5 text-xs font-medium {st.cls}">{st.label}</span>
								<span class="text-xs text-muted-foreground">提交 {fmt(r.createdAt)}</span>
								{#if r.status === "pending"}
									<button type="button" onclick={() => cancel(r.id)}
										class="ml-auto text-xs text-muted-foreground hover:text-destructive">撤回</button>
								{/if}
							</div>
							<p class="mt-2 text-xs text-muted-foreground">证明：{r.proofRef || "—"}</p>
							{#if r.reviewNote}
								<p class="mt-1 text-xs">审核意见（{r.reviewer || "—"}）：{r.reviewNote}</p>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</div>
</Container>
