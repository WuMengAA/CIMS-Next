<script lang="ts">
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { Textarea } from "$lib/components/ui/textarea/index.js";
	import {
		ArrowLeft, CalendarClock, Plus, RefreshCw, Pencil, Power, Play,
		Trash2, Loader2, Info, AlertTriangle
	} from "@lucide/svelte";

	// 定时任务（Svelte 版 · 从原生面板 static/console 的 views.scheduled 迁移）。
	//
	// 数据来源（照旧代码，不发明端点）：
	//   · 列表   GET  /api/console/cims/scheduled-broadcast/list   → { status, items:[...] }
	//   · 新建   POST /api/console/cims/scheduled-broadcast/create
	//   · 修改   PUT  /api/console/cims/scheduled-broadcast/{id}
	//   · 启停   POST /api/console/cims/scheduled-broadcast/{id}/toggle   body { enabled }
	//   · 触发   POST /api/console/cims/scheduled-broadcast/{id}/fire-now
	//   · 删除   DELETE /api/console/cims/scheduled-broadcast/{id}
	//   · 班级   GET  /api/class/list  （自有真源，2026-10-04 收口）
	//
	// 后端调度器每 30s 巡检，到点复用命令通道向目标设备推送大屏通知。

	type ScheduledItem = {
		id: number;
		name?: string;
		schedule_type?: string;
		weekday?: number | null;
		run_at?: string;
		target_class_id?: string | null;
		enabled?: boolean;
		next_run_at?: string;
		last_run_at?: string;
		title?: string;
		content?: string;
	};
	type ClassOpt = { class_id: string; name: string };

	// 后端 scheduled-broadcast 的真实三种类型（见旧面板 `_sbTypeLabel`）。
	// ⚠️ `countdown`（倒计时）不在这里 —— 那是设备「关机调度器」的类型
	//    （ext/stelarith-agent、ClassIsland 关机插件），与定时广播是两个功能。
	const TYPE_LABEL: Record<string, string> = { once: "一次性", daily: "每天", weekly: "每周" };
	const WD = "日一二三四五六";

	let items = $state<ScheduledItem[]>([]);
	let classes = $state<ClassOpt[]>([]);
	let classErr = $state("");
	let listErr = $state("");
	let loading = $state(true);

	// 新建 / 编辑表单
	let editId = $state<number | null>(null);
	let fName = $state("");
	let fType = $state("once");
	let fWeekday = $state(0);
	let fRunAt = $state("");
	let fTitle = $state("");
	let fContent = $state("");
	let fTarget = $state("");
	let saving = $state(false);

	// 行内二次确认删除的目标 id
	let confirmId = $state<number | null>(null);
	let busyId = $state<number | null>(null);

	function fmtTime(iso?: string): string {
		if (!iso) return "—";
		const d = new Date(iso);
		return isNaN(d.getTime())
			? String(iso)
			: d.toLocaleString("zh-CN", { hour12: false });
	}
	// UTC ISO → 浏览器本地 datetime-local 值（回填编辑表单）
	function toLocalInput(iso?: string): string {
		if (!iso) return "";
		const d = new Date(iso);
		if (isNaN(d.getTime())) return "";
		const p = (n: number) => String(n).padStart(2, "0");
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
	}
	function typeText(it: ScheduledItem): string {
		const t = it.schedule_type ?? "";
		const base = TYPE_LABEL[t] ?? t ?? "—";
		if (t === "weekly") return `${base} · 周${WD[it.weekday ?? 0] ?? ""}`;
		return base;
	}
	function className(cid?: string | null): string {
		if (!cid) return "";
		return classes.find((c) => c.class_id === cid)?.name ?? cid;
	}

	const WD_OPTS = [0, 1, 2, 3, 4, 5, 6];
	const hasClasses = $derived(classes.length > 0);

	// 2026-10-05：定时广播切自有（取代 CIMS scheduled-broadcast）。
	// path 形如 "/scheduled-broadcast/list|create|{id}|{id}/toggle|{id}/fire-now"。
	// 建/改都在 POST（body.id 区分）；端点不支持 PUT，方法统一降成 POST。
	async function sbCall(path: string, init?: RequestInit) {
		let url = "/api/console/scheduled-broadcast";
		if (path === "/scheduled-broadcast/list") {
			// GET list
		} else if (path === "/scheduled-broadcast/create") {
			// POST create（body 已在 init）
		} else {
			// /scheduled-broadcast/{id} / {id}/toggle / {id}/fire-now
			const m = path.match(/^\/scheduled-broadcast\/(\d+)(?:\/(toggle|fire-now))?$/);
			if (m) {
				const id = m[1];
				const act = m[2];
				url += `?id=${id}${act ? `&action=${act}` : ""}`;
			}
		}
		const method = (init?.method ?? "GET") === "PUT" ? "POST" : (init?.method ?? "GET");
		const res = await fetch(url, {
			headers: { "Content-Type": "application/json" },
			...init,
			method
		});
		const d = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(d?.error || d?.message || `HTTP ${res.status}`);
		return d;
	}

	async function loadClasses() {
		try {
			const res = await fetch("/api/class/list");
			const d = await res.json();
			if (!res.ok) throw new Error(d?.error || `HTTP ${res.status}`);
			classes = (Array.isArray(d?.classes) ? d.classes : [])
				.map((c: { class_id?: string; name?: string }) => ({
					class_id: String(c.class_id ?? ""),
					name: String(c.name ?? c.class_id ?? "")
				}))
				.filter((c: ClassOpt) => Boolean(c.class_id));
			classErr = "";
		} catch (e) {
			classes = [];
			classErr = (e as Error).message || "班级列表加载失败";
		}
	}

	async function loadList() {
		loading = true;
		listErr = "";
		try {
			const d = await sbCall("/scheduled-broadcast/list");
			items = Array.isArray(d?.items) ? d.items : [];
		} catch (e) {
			items = [];
			listErr = (e as Error).message || "定时任务列表加载失败";
		} finally {
			loading = false;
		}
	}

	function resetForm() {
		editId = null;
		fName = "";
		fType = "once";
		fWeekday = 0;
		fRunAt = "";
		fTitle = "";
		fContent = "";
		fTarget = "";
	}

	function startEdit(it: ScheduledItem) {
		editId = it.id;
		fName = it.name ?? "";
		fType = it.schedule_type ?? "once";
		fWeekday = it.weekday ?? 0;
		fRunAt = toLocalInput(it.run_at);
		fTitle = it.title ?? "";
		fContent = it.content ?? "";
		fTarget = it.target_class_id ?? "";
	}

	async function save() {
		if (!fName.trim()) {
			toast.error("请填写名称");
			return;
		}
		if (!fRunAt) {
			toast.error("请选择时间");
			return;
		}
		const body = {
			id: editId != null ? editId : undefined,
			name: fName.trim(),
			schedule_type: fType,
			run_at: new Date(fRunAt).toISOString(),
			weekday: fType === "weekly" ? Number(fWeekday) : null,
			title: fTitle.trim(),
			content: fContent,
			target_class_id: fTarget || "",
			enabled: true
		};
		saving = true;
		try {
			if (editId != null) {
				await sbCall(`/scheduled-broadcast/${editId}`, {
					method: "PUT",
					body: JSON.stringify(body)
				});
				toast.success("已保存修改");
			} else {
				await sbCall("/scheduled-broadcast/create", {
					method: "POST",
					body: JSON.stringify(body)
				});
				toast.success("已新建定时任务");
			}
			resetForm();
			await loadList();
		} catch (e) {
			toast.error("保存失败：" + ((e as Error).message || e));
		} finally {
			saving = false;
		}
	}

	async function toggle(it: ScheduledItem) {
		busyId = it.id;
		try {
			await sbCall(`/scheduled-broadcast/${it.id}/toggle`, {
				method: "POST",
				body: JSON.stringify({ enabled: !it.enabled })
			});
			toast.success(it.enabled ? "已停用" : "已启用");
			await loadList();
		} catch (e) {
			toast.error("操作失败：" + ((e as Error).message || e));
		} finally {
			busyId = null;
		}
	}

	async function fire(it: ScheduledItem) {
		busyId = it.id;
		try {
			const r = await sbCall(`/scheduled-broadcast/${it.id}/fire-now`, {
				method: "POST",
				body: "{}"
			});
			toast.success("已触发，触达 " + (r?.delivered ?? 0) + " 台");
		} catch (e) {
			toast.error("触发失败：" + ((e as Error).message || e));
		} finally {
			busyId = null;
		}
	}

	async function remove(id: number) {
		busyId = id;
		try {
			await sbCall(`/scheduled-broadcast/${id}`, { method: "DELETE" });
			toast.success("已删除");
			confirmId = null;
			await loadList();
		} catch (e) {
			toast.error("删除失败：" + ((e as Error).message || e));
		} finally {
			busyId = null;
		}
	}

	onMount(() => {
		loadClasses();
		loadList();
	});
</script>

<svelte:head>
	<title>定时任务 · 集控面板 | Stelarith</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
	<a
		href="/admin/console"
		class="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
	>
		<ArrowLeft class="size-4" /> 回概览
	</a>

	<div class="flex items-center gap-3">
		<div class="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
			<CalendarClock class="size-5" />
		</div>
		<div>
			<h1 class="font-heading text-lg font-semibold">定时任务</h1>
			<p class="text-xs text-muted-foreground">到点自动向目标设备推送大屏通知，复用现有命令通道，教室端无需更新。</p>
		</div>
	</div>

	<div class="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
		<Info class="mt-0.5 size-3.5 shrink-0" />
		<p>后台调度器每 30s 巡检一次；「启用/停用」控制是否参与巡检，「立即触发」跳过等待、马上广播一次。</p>
	</div>

	<!-- ── 新建 / 编辑 ─────────────────────────────────────────── -->
	<div class="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
		<h2 class="mb-3 text-sm font-semibold">{editId != null ? "编辑定时任务" : "新建定时任务"}</h2>
		<div class="grid gap-3">
			<div class="grid gap-1.5">
				<Label for="sb-name">名称</Label>
				<input
					id="sb-name"
					type="text"
					bind:value={fName}
					placeholder="如 早读提醒"
					class="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
				/>
			</div>

			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<div class="grid gap-1.5">
					<Label for="sb-type">类型</Label>
					<select
						id="sb-type"
						bind:value={fType}
						class="h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
					>
						<option value="once">一次性</option>
						<option value="daily">每天</option>
						<option value="weekly">每周</option>
					</select>
				</div>
				{#if fType === "weekly"}
					<div class="grid gap-1.5">
						<Label for="sb-weekday">星期</Label>
						<select
							id="sb-weekday"
							bind:value={fWeekday}
							class="h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
						>
							{#each WD_OPTS as w (w)}<option value={w}>周{WD[w]}</option>{/each}
						</select>
					</div>
				{/if}
			</div>

			<div class="grid gap-1.5">
				<Label for="sb-runat">时间</Label>
				<input
					id="sb-runat"
					type="datetime-local"
					bind:value={fRunAt}
					class="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
				/>
			</div>

			<div class="grid gap-1.5">
				<Label for="sb-title">大屏通知标题（选填）</Label>
				<input
					id="sb-title"
					type="text"
					bind:value={fTitle}
					placeholder="大屏通知标题"
					class="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
				/>
			</div>

			<div class="grid gap-1.5">
				<Label for="sb-content">正文（选填）</Label>
				<Textarea id="sb-content" bind:value={fContent} placeholder="要广播的内容" rows={3} />
			</div>

			<div class="grid gap-1.5">
				<Label for="sb-target">目标班级</Label>
				<select
					id="sb-target"
					bind:value={fTarget}
					class="h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
				>
					<option value="">全校</option>
					{#each classes as c (c.class_id)}<option value={c.class_id}>{c.name}</option>{/each}
				</select>
				{#if !hasClasses}
					<!-- ⚠️ 班级下拉语义：真实班级唯一来源是 /api/class/list（自有真源，2026-10-04 收口）。
					     取不到时**只保留「全校」**并在此明示原因，绝不放置任何演示班 / 假班。 -->
					<p class="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
						<AlertTriangle class="mt-0.5 size-3.5 shrink-0" />
						<span>
							班级列表不可用（{classErr || "CIMS 尚未导入班级"}），本次只能选「全校」。
							本页只使用 CIMS 的真实班级，不会回退到演示班级。
						</span>
					</p>
				{/if}
			</div>

			<div class="flex items-center gap-2">
				<Button onclick={save} disabled={saving} class="gap-1.5">
					{#if saving}<Loader2 class="size-4 animate-spin" />{:else}<Plus class="size-4" />{/if}
					{editId != null ? "保存修改" : "新建"}
				</Button>
				{#if editId != null}
					<Button variant="outline" onclick={resetForm} disabled={saving}>取消编辑</Button>
				{/if}
			</div>
		</div>
	</div>

	<!-- ── 列表 ────────────────────────────────────────────────── -->
	<div class="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
		<div class="mb-3 flex items-center justify-between gap-2">
			<h2 class="text-sm font-semibold">定时任务列表（{items.length}）</h2>
			<Button variant="outline" size="sm" onclick={loadList} disabled={loading}>
				<RefreshCw class="mr-1.5 size-3.5" /> 刷新
			</Button>
		</div>

		{#if listErr}
			<p class="flex items-start gap-1.5 text-xs text-destructive">
				<AlertTriangle class="mt-0.5 size-3.5 shrink-0" /> {listErr}
			</p>
		{:else if loading}
			<p class="flex items-center gap-2 py-6 text-xs text-muted-foreground">
				<Loader2 class="size-3.5 animate-spin" /> 加载中…
			</p>
		{:else if !items.length}
			<p class="py-6 text-center text-xs text-muted-foreground">暂无定时任务，新建一条试试。</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b text-left text-xs text-muted-foreground">
							<th class="py-2 pr-3 font-medium">名称</th>
							<th class="py-2 pr-3 font-medium">类型</th>
							<th class="py-2 pr-3 font-medium">目标班级</th>
							<th class="py-2 pr-3 font-medium">锚定时间</th>
							<th class="py-2 pr-3 font-medium">下次 / 上次</th>
							<th class="py-2 pr-3 font-medium">状态</th>
							<th class="py-2 font-medium">操作</th>
						</tr>
					</thead>
					<tbody>
						{#each items as it (it.id)}
							<tr class="border-b align-top" data-id={it.id}>
								<td class="py-2 pr-3">
									{it.name || "(未命名)"}
									{#if it.title}<div class="text-xs text-muted-foreground">标题：{it.title}</div>{/if}
								</td>
								<td class="py-2 pr-3">
									<Badge variant="secondary">{typeText(it)}</Badge>
								</td>
								<td class="py-2 pr-3">
									{#if it.target_class_id}
										{className(it.target_class_id)}
									{:else}
										<b>全校</b>
									{/if}
								</td>
								<td class="py-2 pr-3 text-xs text-muted-foreground">{fmtTime(it.run_at)}</td>
								<td class="py-2 pr-3 text-xs text-muted-foreground">
									<div>下次：{fmtTime(it.next_run_at)}</div>
									<div>上次：{fmtTime(it.last_run_at)}</div>
								</td>
								<td class="py-2 pr-3">
									<Badge variant={it.enabled ? "default" : "outline"}>{it.enabled ? "启用" : "停用"}</Badge>
								</td>
								<td class="py-2">
									{#if confirmId === it.id}
										<span class="inline-flex items-center gap-1.5 whitespace-nowrap">
											<span class="text-xs text-destructive">确认删除？</span>
											<Button
												variant="destructive"
												size="sm"
												onclick={() => remove(it.id)}
												disabled={busyId === it.id}
											>
												{busyId === it.id ? "删除中…" : "确认删除"}
											</Button>
											<Button variant="outline" size="sm" onclick={() => (confirmId = null)}>取消</Button>
										</span>
									{:else}
										<span class="inline-flex flex-wrap items-center gap-1.5">
											<Button variant="outline" size="sm" onclick={() => startEdit(it)}>
												<Pencil class="size-3.5" /> 编辑
											</Button>
											<Button variant="outline" size="sm" onclick={() => toggle(it)} disabled={busyId === it.id}>
												<Power class="size-3.5" /> {it.enabled ? "停用" : "启用"}
											</Button>
											<Button variant="outline" size="sm" onclick={() => fire(it)} disabled={busyId === it.id}>
												<Play class="size-3.5" /> 立即触发
											</Button>
											<Button variant="destructive" size="sm" onclick={() => (confirmId = it.id)}>
												<Trash2 class="size-3.5" /> 删除
											</Button>
										</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</div>
