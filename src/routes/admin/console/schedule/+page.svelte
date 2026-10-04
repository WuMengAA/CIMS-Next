<script lang="ts">
	// 课表 + 调课（2026-10-05 · 自有真源，取代 CIMS ClassPlan；调课/换课是含金量）
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { toast } from "svelte-sonner";
	import { CalendarDays, ArrowRightLeft, Loader2, RefreshCw, CheckCircle2, XCircle, Clock } from "@lucide/svelte";
	import { onMount } from "svelte";

	interface Period {
		id: number; period_no: number; name: string; start_time: string; end_time: string;
	}
	interface Cell {
		id: number; class_id: string; weekday: number; period_no: number;
		subject: string; teacher: string; remark: string;
	}
	interface Swap {
		id: number; class_id: string; from_weekday: number; from_period: number;
		to_weekday: number; to_period: number; reason: string;
		requested_by: string; status: string; reviewed_by: string; created_at: string;
	}
	interface ClassOpt { class_id: string; name: string; }

	const WD = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];

	let classes = $state<ClassOpt[]>([]);
	let selClass = $state("");
	let periods = $state<Period[]>([]);
	let grid = $state<Cell[]>([]);
	let swaps = $state<Swap[]>([]);
	let loading = $state(true);
	let err = $state("");

	// 调课表单
	let fFromW = $state(1), fFromP = $state(1), fToW = $state(1), fToP = $state(2);
	let fReason = $state("");
	let submitting = $state(false);
	let swapMsg = $state<{ ok: boolean; text: string } | null>(null);

	// 课表编辑（管理端）
	let editW = $state(1), editP = $state(1);
	let editSubject = $state(""), editTeacher = $state("");
	let editMsg = $state<{ ok: boolean; text: string } | null>(null);
	let canManage = $state(false);

	async function load() {
		loading = true; err = "";
		try {
			const [cr, sr] = await Promise.all([
				fetch("/api/class/list"),
				fetch(`/api/console/schedule${selClass ? `?classId=${encodeURIComponent(selClass)}` : ""}`)
			]);
			const cd = await cr.json();
			const sd = await sr.json();
			if (!cr.ok || !sr.ok) throw new Error(cd.error || sd.error || "加载失败");
			classes = Array.isArray(cd.classes) ? cd.classes : [];
			periods = Array.isArray(sd.timetable) ? sd.timetable : [];
			grid = Array.isArray(sd.schedule) ? sd.schedule : [];
			swaps = Array.isArray(sd.swaps) ? sd.swaps : [];
			if (!selClass && classes.length) selClass = classes[0].class_id;
		} catch (e) {
			err = (e as Error)?.message || "加载失败";
		} finally {
			loading = false;
		}
	}

	// 切班后重拉课表（用 onchange 事件，不用 $effect——避免依赖循环）
	async function onClassChange() {
		await load();
	}

	function cellOf(w: number, p: number): Cell | undefined {
		return grid.find((c) => c.weekday === w && c.period_no === p);
	}

	function periodName(p: number): string {
		const it = periods.find((x) => x.period_no === p);
		return it ? `${it.name}${it.start_time ? ` ${it.start_time}` : ""}` : `第${p}节`;
	}

	// 提交调课申请
	async function submitSwap() {
		submitting = true; swapMsg = null;
		try {
			const r = await fetch("/api/console/schedule", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					classId: selClass, fromWeekday: fFromW, fromPeriod: fFromP,
					toWeekday: fToW, toPeriod: fToP, reason: fReason
				})
			});
			const d = await r.json();
			if (!r.ok) { swapMsg = { ok: false, text: d.error || "提交失败" }; return; }
			swapMsg = { ok: true, text: `调课申请已提交：周${fFromW}第${fFromP}节 ↔ 周${fToW}第${fToP}节（待审批）` };
			toast.success("调课申请已提交");
			await load();
		} catch {
			swapMsg = { ok: false, text: "网络错误，请重试" };
		} finally {
			submitting = false;
		}
	}

	// 审批（approve 生效=对调两节课）
	async function reviewSwap(s: Swap, action: "approve" | "reject") {
		try {
			const r = await fetch(`/api/console/schedule?action=${action}&id=${s.id}`, { method: "PATCH" });
			const d = await r.json();
			if (!r.ok) throw new Error(d.error || "审批失败");
			toast.success(action === "approve" ? "已批准，调课生效" : "已驳回");
			await load();
		} catch (e) {
			toast.error((e as Error)?.message || "审批失败");
		}
	}

	// 课表编辑（写一格）
	async function saveCell() {
		editMsg = null;
		if (!editSubject.trim()) { editMsg = { ok: false, text: "科目不能为空" }; return; }
		try {
			const r = await fetch("/api/console/schedule/cell", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ classId: selClass, weekday: editW, periodNo: editP, subject: editSubject, teacher: editTeacher })
			});
			const d = await r.json();
			if (!r.ok) throw new Error(d.error || "写入失败");
			editMsg = { ok: true, text: `已写入：周${editW}第${editP}节 = ${editSubject}` };
			editSubject = ""; editTeacher = "";
			await load();
		} catch (e) {
			editMsg = { ok: false, text: (e as Error)?.message || "写入失败" };
		}
	}

	// 清一格
	async function clearCell(w: number, p: number) {
		try {
			const r = await fetch(`/api/console/schedule/cell?classId=${encodeURIComponent(selClass)}&weekday=${w}&periodNo=${p}`, { method: "DELETE" });
			if (!r.ok) throw new Error("清空失败");
			toast.success(`已清空 周${w}第${p}节`);
			await load();
		} catch (e) {
			toast.error((e as Error)?.message || "清空失败");
		}
	}

	onMount(() => { load(); });
</script>

<svelte:head>
	<title>课表与调课 · 集控面板 | Stelarith</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-4xl p-4 md:p-6">
	<div class="mb-5 flex items-center gap-3">
		<div class="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary"><CalendarDays class="size-5" /></div>
		<div>
			<h1 class="font-heading text-lg font-semibold">课表与调课</h1>
			<p class="text-xs text-muted-foreground">课表按班 · 作息全校共用 · 调课（换课）申请→审批→生效</p>
		</div>
		<div class="ml-auto"><Button variant="ghost" size="sm" class="gap-1.5" onclick={load}><RefreshCw class="size-3.5" /> 刷新</Button></div>
	</div>

	{#if loading}
		<div class="py-10 text-center text-sm text-muted-foreground inline-flex items-center gap-2"><Loader2 class="size-4 animate-spin" /> 加载中…</div>
	{:else if err}
		<div class="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{err}</div>
	{:else}
		<!-- 班级选择 + 作息 -->
		<div class="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
			<div class="flex flex-wrap items-center gap-3">
				<Label>班级</Label>
				<select class="h-9 rounded-md border border-input bg-background px-3 text-sm" bind:value={selClass} onchange={onClassChange}>
					{#each classes as c (c.class_id)}<option value={c.class_id}>{c.name}</option>{/each}
				</select>
				<div class="ml-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
					<Clock class="size-3.5" /> 作息：
					{#each periods as p (p.id)}<Badge variant="outline" class="px-2 py-0.5 text-[10px]">{p.period_no}.{p.start_time || ""}</Badge>{/each}
				</div>
			</div>
		</div>

		<!-- 课表网格 -->
		<div class="mt-4 overflow-x-auto rounded-xl border border-border/60 bg-card p-4 shadow-sm">
			<table class="w-full min-w-[560px] border-collapse text-sm">
				<thead>
					<tr class="border-b border-border/60">
						<th class="py-2 pr-2 text-left font-medium text-muted-foreground">节次</th>
						{#each WD as wd, i}
							{#if i > 0}<th class="px-2 py-2 text-center font-medium">{wd}</th>{/if}
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each periods as p (p.id)}
						<tr class="border-b border-border/40">
							<td class="py-2 pr-2 text-xs text-muted-foreground whitespace-nowrap">{p.name}{p.start_time ? ` ${p.start_time}` : ""}</td>
							{#each WD as wd, w}
								{#if w > 0}
									{@const c = cellOf(w, p.period_no)}
									<td class="px-1 py-1 text-center align-top">
										{#if c}
											<div class="rounded-md border border-border/60 bg-muted/30 p-1.5">
												<div class="text-xs font-medium">{c.subject}</div>
												{#if c.teacher}<div class="text-[10px] text-muted-foreground">{c.teacher}</div>{/if}
											</div>
										{:else}
											<div class="rounded-md border border-dashed border-border/40 p-1.5 text-[10px] text-muted-foreground">—</div>
										{/if}
									</td>
								{/if}
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<!-- 调课申请 -->
		<div id="swap" class="mt-4 rounded-xl border border-border/60 bg-card p-5 shadow-sm">
			<h2 class="flex items-center gap-2 font-heading text-base font-semibold"><ArrowRightLeft class="size-4" /> 调课（换课）申请</h2>
			<div class="mt-3 grid gap-2 sm:grid-cols-2">
				<div class="flex items-center gap-2">
					<Label class="whitespace-nowrap">原节</Label>
					<select class="h-9 rounded-md border border-input bg-background px-2 text-sm" bind:value={fFromW}>
						{#each [1,2,3,4,5,6,7] as x}<option value={x}>{WD[x]}</option>{/each}
					</select>
					<select class="h-9 rounded-md border border-input bg-background px-2 text-sm" bind:value={fFromP}>
						{#each Array(periods.length || 8) as _, i}<option value={i + 1}>第{i + 1}节</option>{/each}
					</select>
				</div>
				<div class="flex items-center gap-2">
					<Label class="whitespace-nowrap">调至</Label>
					<select class="h-9 rounded-md border border-input bg-background px-2 text-sm" bind:value={fToW}>
						{#each [1,2,3,4,5,6,7] as x}<option value={x}>{WD[x]}</option>{/each}
					</select>
					<select class="h-9 rounded-md border border-input bg-background px-2 text-sm" bind:value={fToP}>
						{#each Array(periods.length || 8) as _, i}<option value={i + 1}>第{i + 1}节</option>{/each}
					</select>
				</div>
			</div>
			<div class="mt-2 grid gap-1.5">
				<Label for="swap-reason">调课原因</Label>
				<Input id="swap-reason" bind:value={fReason} placeholder="如：数学老师周四下午教研，与周二第2节语文对调" />
			</div>
			{#if swapMsg}<p class="mt-2 text-sm {swapMsg.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}">{swapMsg.text}</p>{/if}
			<div class="mt-3 flex items-center gap-2">
				<Button onclick={submitSwap} disabled={submitting} class="gap-1.5">
					{#if submitting}<Loader2 class="size-4 animate-spin" />{:else}<ArrowRightLeft class="size-4" />{/if} 提交调课申请
				</Button>
				<span class="text-xs text-muted-foreground">审批通过后两节课自动对调</span>
			</div>
		</div>

		<!-- 调课申请列表 / 审批 -->
		<div class="mt-4 rounded-xl border border-border/60 bg-card p-5 shadow-sm">
			<h2 class="flex items-center gap-2 font-heading text-base font-semibold"><Clock class="size-4" /> 调课记录</h2>
			{#if swaps.length === 0}
				<p class="mt-2 text-sm text-muted-foreground">暂无调课申请。</p>
			{:else}
				<div class="mt-3 grid gap-2">
					{#each swaps as s (s.id)}
						<div class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 p-3">
							<div class="min-w-0 text-sm">
								<div>
									<span class="font-medium">周{s.from_weekday}第{s.from_period}节</span>
									<span class="text-muted-foreground"> ↔ </span>
									<span class="font-medium">周{s.to_weekday}第{s.to_period}节</span>
									{#if s.reason}<span class="ml-2 text-xs text-muted-foreground">（{s.reason}）</span>{/if}
								</div>
								<div class="mt-0.5 text-xs text-muted-foreground">
									申请：{s.requested_by}{s.reviewed_by ? ` · 审批：${s.reviewed_by}` : ""} · {s.created_at?.slice(0, 16)?.replace("T", " ")}
								</div>
							</div>
							<div class="flex shrink-0 items-center gap-2">
								{#if s.status === "pending"}
									<Button size="sm" class="gap-1" onclick={() => reviewSwap(s, "approve")}><CheckCircle2 class="size-3.5" /> 批准（生效）</Button>
									<Button size="sm" variant="destructive" class="gap-1" onclick={() => reviewSwap(s, "reject")}><XCircle class="size-3.5" /> 驳回</Button>
								{:else}
									<Badge variant={s.status === "applied" ? "default" : s.status === "rejected" ? "destructive" : "secondary"}>
										{s.status === "applied" ? "已生效" : s.status === "rejected" ? "已驳回" : "待审批"}
									</Badge>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- 课表编辑（管理端） -->
		<div class="mt-4 rounded-xl border border-border/60 bg-card p-5 shadow-sm">
			<h2 class="flex items-center gap-2 font-heading text-base font-semibold"><CalendarDays class="size-4" /> 课表维护</h2>
			<div class="mt-3 flex flex-wrap items-end gap-3">
				<div class="flex items-center gap-2">
					<Label class="whitespace-nowrap">位置</Label>
					<select class="h-9 rounded-md border border-input bg-background px-2 text-sm" bind:value={editW}>
						{#each [1,2,3,4,5,6,7] as x}<option value={x}>{WD[x]}</option>{/each}
					</select>
					<select class="h-9 rounded-md border border-input bg-background px-2 text-sm" bind:value={editP}>
						{#each Array(periods.length || 8) as _, i}<option value={i + 1}>第{i + 1}节</option>{/each}
					</select>
				</div>
				<div class="grid gap-1.5">
					<Label for="edit-subject">科目</Label>
					<Input id="edit-subject" bind:value={editSubject} placeholder="如 数学" class="w-32" />
				</div>
				<div class="grid gap-1.5">
					<Label for="edit-teacher">教师</Label>
					<Input id="edit-teacher" bind:value={editTeacher} placeholder="选填" class="w-32" />
				</div>
				<Button onclick={saveCell}>写入</Button>
				<Button variant="outline" onclick={() => clearCell(editW, editP)}>清空此格</Button>
				{#if editMsg}<span class="text-sm {editMsg.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}">{editMsg.text}</span>{/if}
			</div>
		</div>
	{/if}
</div>