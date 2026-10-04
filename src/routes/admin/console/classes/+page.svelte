<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { toast } from "svelte-sonner";
	import { UsersRound, Clock, CheckCircle2, XCircle, Loader2, Plus, RefreshCw, Building2 } from "@lucide/svelte";

	let { data } = $props<{
		data: {
			username: string;
			displayName: string;
			role: string;
			className: string;
			gradeName: string;
			canReview: boolean;
			canCreate: boolean;
		};
	}>();

	interface ClassItem {
		class_id: string;
		name: string;
		code: string;
		review_status?: string;
		device_count?: number;
	}
	interface PendingItem extends ClassItem {
		owner_user_id?: string;
		graduation_year?: number | null;
		class_number?: number | null;
		created_at?: string | null;
	}

	let allClasses = $state<ClassItem[]>([]);
	let pending = $state<PendingItem[]>([]);
	let pendingCount = $state(0);
	let loading = $state(true);
	let listError = $state("");

	// 新建班级表单
	let showCreate = $state(false);
	let gradYear = $state("");
	let classNum = $state("");
	let classNameNew = $state("");
	let creating = $state(false);
	let createMsg = $state<{ ok: boolean; text: string } | null>(null);

	// 审核操作中的 id
	let reviewingId = $state("");

	function statusBadge(status?: string): { label: string; variant: "secondary" | "default" | "destructive" | "outline" } {
		switch (status) {
			case "approved":
				return { label: "已通过", variant: "default" };
			case "rejected":
				return { label: "已驳回", variant: "destructive" };
			case "pending":
				return { label: "审核中", variant: "secondary" };
			default:
				return { label: String(status ?? "未知"), variant: "outline" };
		}
	}

	async function loadAll() {
		loading = true;
		listError = "";
		try {
			// 2026-10-04：切自有班级真源（彻底去 CIMS），响应 {classes, source}
			const res = await fetch("/api/class/list");
			const d = await res.json();
			if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
			allClasses = Array.isArray(d.classes) ? (d.classes as ClassItem[]) : [];
			// 自有真源没有"待审队列"（建班即生效），管理端待审区不再拉 CIMS
			pending = [];
			pendingCount = 0;
		} catch (e) {
			listError = (e as Error).message || "加载失败";
		} finally {
			loading = false;
		}
	}

	// 「我的班级」：取与当前用户绑定班名对应的班级实体（CIMS 列表含全量，按班名归一命中）。
	// 命中后可展示其审核态 —— pending 即给出「班级审核中」提示。
	const myClass = $derived.by(() => {
		const own = (data.className || "").trim();
		if (!own) return null;
		const digit = (s: string) => (s.match(/\d+/g) || []).map((x) => String(Number(x))).join("");
		return (
			allClasses.find((c) => c.name === own || c.code === own || (digit(c.name) && digit(c.name) === digit(own))) ?? null
		);
	});

	async function createClass() {
		// 2026-10-04：切自有建班（彻底去 CIMS）——只需班级名，建班即生效，无审核流
		const name = classNameNew.trim();
		if (!name) {
			createMsg = { ok: false, text: "请填写班级名（如 13班 / 2025届3班）" };
			return;
		}
		creating = true;
		createMsg = null;
		try {
			const res = await fetch("/api/class", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name })
			});
			const d = await res.json();
			if (!res.ok) {
				createMsg = { ok: false, text: d.error || `创建失败（HTTP ${res.status}）` };
				return;
			}
			createMsg = { ok: true, text: `班级已创建：${d.class?.name ?? name}（${d.class?.class_id ?? ""}）` };
			toast.success("班级已创建");
			showCreate = false;
			gradYear = "";
			classNum = "";
			classNameNew = "";
			await loadAll();
		} catch (e) {
			createMsg = { ok: false, text: "网络错误，请重试" };
		} finally {
			creating = false;
		}
	}

	async function review(id: string, action: "approve" | "reject") {
		// 自有真源无审核流（建班即生效）——保留函数避免模板引用错误，实际不再调用
		void id;
		void action;
		await loadAll();
	}

	loadAll();
</script>

<svelte:head>
	<title>班级管理 · 集控面板 | Stelarith</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-3xl p-4 md:p-6">
	<div class="mb-5 flex items-center gap-3">
		<div class="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
			<UsersRound class="size-5" />
		</div>
		<div>
			<h1 class="font-heading text-lg font-semibold">班级管理</h1>
			<p class="text-xs text-muted-foreground">班级实体由站点自有数据源维护（已脱离 CIMS），建班即生效</p>
		</div>
	</div>

	{#if loading}
		<div class="py-10 text-center text-sm text-muted-foreground inline-flex items-center gap-2"><Loader2 class="size-4 animate-spin" /> 加载中…</div>
	{:else if listError}
		<div class="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{listError}</div>
	{:else}
		<!-- 我的班级 + 班级审核中提示 -->
		<section class="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
			<h2 class="flex items-center gap-2 font-heading text-base font-semibold"><Building2 class="size-4" /> 我的班级</h2>
			{#if !data.className}
				<p class="mt-2 text-sm text-muted-foreground">你尚未绑定班级。请先到「班级绑定」选择你的班级。</p>
			{:else if !myClass}
				<p class="mt-2 text-sm text-muted-foreground">未找到与「{data.className}」对应的班级实体，可能尚未创建。</p>
			{:else}
				<div class="mt-3 flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 p-3">
					<div>
						<div class="text-sm font-medium">{myClass.name}{myClass.code && myClass.code !== myClass.name ? ` · ${myClass.code}` : ""}</div>
						<div class="text-xs text-muted-foreground">设备数：{myClass.device_count ?? 0}</div>
					</div>
					<Badge variant={statusBadge(myClass.review_status).variant}>{statusBadge(myClass.review_status).label}</Badge>
				</div>
				{#if myClass.review_status === "pending"}
					<div class="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
						<Clock class="mt-0.5 size-4 shrink-0" />
						<div>
							<p class="font-medium">班级审核中</p>
							<p class="mt-0.5 text-xs">你的班级正在等待管理员审核。审核通过前暂不能绑定设备 / 下发内容，请耐心等待。</p>
						</div>
					</div>
				{:else if myClass.review_status === "rejected"}
					<div class="mt-3 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
						<XCircle class="mt-0.5 size-4 shrink-0" />
						<div><p class="font-medium">班级被驳回</p><p class="mt-0.5 text-xs">请联系管理员了解原因后重新提交。</p></div>
					</div>
				{/if}
			{/if}

			{#if data.canCreate}
				<div class="mt-4">
					{#if !showCreate}
						<Button variant="outline" class="gap-1.5" onclick={() => (showCreate = true)}><Plus class="size-4" /> 新建班级</Button>
					{:else}
						<div class="mt-2 grid gap-3 rounded-lg border border-border/60 bg-muted/20 p-3">
							<div class="grid gap-1.5">
								<Label for="cn-name">班级名</Label>
								<Input id="cn-name" bind:value={classNameNew} placeholder="如 13班 / 2025届3班" />
							</div>
							{#if createMsg}<p class="text-sm {createMsg.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}">{createMsg.text}</p>{/if}
							<div class="flex items-center gap-2">
								<Button onclick={createClass} disabled={creating} class="gap-1.5">
									{#if creating}<Loader2 class="size-4 animate-spin" />{:else}<Plus class="size-4" />{/if} 创建班级
								</Button>
								<Button variant="outline" onclick={() => (showCreate = false)}>取消</Button>
							</div>
						</div>
					{/if}
				</div>
			{/if}
		</section>

		<div class="mt-4 flex justify-end">
			<Button variant="ghost" size="sm" class="gap-1.5" onclick={loadAll}><RefreshCw class="size-3.5" /> 刷新</Button>
		</div>
	{/if}
</div>
