<script lang="ts">
	import { onMount } from "svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Textarea } from "$lib/components/ui/textarea/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { toast } from "svelte-sonner";
	import {
		ArrowLeft,
		Dices,
		Users,
		Trash2,
		RotateCcw,
		Download,
		Loader2,
		AlertTriangle,
		ListChecks,
		Shuffle
	} from "@lucide/svelte";

	// 随机抽取 · 课堂点名（Svelte 版 · 2026-10-02 从原生面板 views.random 迁移）。
	//
	// 纯前端工具：不依赖后端、离线可用。名单 / 抽取历史 / 「已抽」标记都写在本机
	// localStorage，键名与旧面板完全一致（console.random.*），于是旧面板里的名单
	// 迁到新页依然在，刷新页面也不会丢。
	//
	// 语义逐字对照 static/console/app.js 的 views.random + 对应事件处理：
	//   · 导入：textarea 按行 trim，空行丢弃；导入后重置「已抽」，抽取历史保留。
	//   · 防重复（默认开）：抽过（按名单下标记）的人不再进池；关闭则每次全量入池，
	//     但**无论开不开，抽中的人都会被记进「已抽」**（旧实现如此，逐字保留）。
	//   · 抽取：Fisher–Yates 洗牌后取前 n 个；n 超过剩余人数时只取剩余全部。
	//   · 重置已抽：只清「已抽」标记，历史保留。清空名单：名单 / 已抽 / 历史 全清。
	//   · 结果区展示最后一批（🎲 名字、名字）；历史按「第 N 批：…」逐批列出。
	//
	// 与旧实现的两处**有意**差异：
	//   ① 「从班级设备导入」：旧代码取 /class/list 后又去读并不存在的
	//      deviceMap / devices 字段，结果恒为空。新页改取真实班级设备
	//      /api/console/control/device-status，取不到时给出可读原因，绝不静默空。
	//   ② 抽取加了约 0.6s 的「正在抽取…」过渡以补齐四态展示，不改抽取结果语义。

	const LS_NAMES = "console.random.names";
	const LS_HISTORY = "console.random.history";
	const LS_DRAWN = "console.random.drawn";

	let names = $state<string[]>([]);
	let drawn = $state<number[]>([]); // 已抽名单下标（旧实现 randomDrawn:Set）
	let history = $state<string[][]>([]); // 每批一个名字数组

	let input = $state("");
	let count = $state(3); // 「抽 N 人」的人数，旧默认 3
	let nodup = $state(true); // 防重复，旧默认开
	let drawing = $state(false);
	let fromBusy = $state(false);
	let error = $state("");

	const avail = $derived(names.filter((_, i) => !drawn.includes(i)).length);
	const lastBatch = $derived(history.length ? history[history.length - 1] : []);

	function save() {
		try {
			localStorage.setItem(LS_NAMES, JSON.stringify(names));
			localStorage.setItem(LS_HISTORY, JSON.stringify(history));
			localStorage.setItem(LS_DRAWN, JSON.stringify(drawn));
		} catch {
			/* 隐私模式 / 配额满：抽取本身不受影响，静默即可 */
		}
	}

	onMount(() => {
		try {
			const a = JSON.parse(localStorage.getItem(LS_NAMES) || "null");
			if (Array.isArray(a)) names = a.filter((x) => typeof x === "string");
			const b = JSON.parse(localStorage.getItem(LS_HISTORY) || "null");
			if (Array.isArray(b)) history = b.filter(Array.isArray).map((r) => r.map(String));
			const c = JSON.parse(localStorage.getItem(LS_DRAWN) || "null");
			if (Array.isArray(c)) drawn = c.filter((x) => typeof x === "number");
		} catch {
			/* 脏数据忽略，从空开始 */
		}
	});

	// 旧实现的 _randomPick：洗牌取前 k 个，并把抽中的下标并入「已抽」。
	function pick(k: number, useDrawn: boolean): string[] {
		const pool = names
			.map((n, i) => ({ n, i }))
			.filter((x) => (useDrawn ? !drawn.includes(x.i) : true));
		if (!pool.length) return [];
		const n = Math.min(k, pool.length);
		for (let i = pool.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[pool[i], pool[j]] = [pool[j], pool[i]];
		}
		const picked = pool.slice(0, n);
		drawn = [...new Set([...drawn, ...picked.map((x) => x.i)])];
		return picked.map((x) => x.n);
	}

	function importNames() {
		const list = input
			.split(/\r?\n/)
			.map((s) => s.trim())
			.filter(Boolean);
		if (!list.length) {
			error = "名单为空：请在文本框里每行填一个名字。";
			toast.error("名单为空");
			return;
		}
		names = list;
		drawn = [];
		save();
		error = "";
		toast.success(`已导入 ${list.length} 人`);
	}

	function clearList() {
		names = [];
		drawn = [];
		history = [];
		save();
		error = "";
		toast.success("已清空名单与抽取历史");
	}

	function resetDrawn() {
		drawn = [];
		save();
		toast.success("已重置「已抽」标记");
	}

	async function draw(k: number) {
		if (drawing) return;
		if (!names.length) {
			error = "名单为空，请先导入名单或从班级设备导入。";
			toast.error("请先导入名单");
			return;
		}
		error = "";
		drawing = true;
		await new Promise((r) => setTimeout(r, 600));
		const picked = pick(k, nodup);
		drawing = false;
		if (!picked.length) {
			error = nodup ? "已抽完，点「重置已抽」重来。" : "已抽完或名单为空。";
			toast.error(error);
			return;
		}
		history = [...history, picked];
		save();
	}

	async function drawN() {
		let n = Math.floor(Number(count));
		if (!Number.isFinite(n) || n < 1) {
			n = 1;
			count = 1;
			error = "抽取人数至少为 1，已按 1 人处理。";
		}
		await draw(n);
	}

	async function fromClass() {
		if (fromBusy) return;
		fromBusy = true;
		error = "";
		try {
			const r = await fetch("/api/console/control/device-status", { credentials: "same-origin" });
			const j = await r.json().catch(() => ({}));
			if (!r.ok) throw new Error(j?.error ? String(j.error) : `设备列表加载失败（错误码 ${r.status}）`);
			const devs = Array.isArray(j?.devices) ? j.devices : [];
			const list = devs
				.map((d: Record<string, unknown>) => String(d.host || d.client_id || "").trim())
				.filter(Boolean);
			if (!list.length) {
				error =
					"没有可导入的班级设备：CIMS 里还没有已绑定的教室设备。注意导入的是设备名（不是学生姓名），导入后请自行核对/编辑。";
				toast.error("没有可导入的班级设备");
				return;
			}
			names = list;
			drawn = [];
			save();
			toast.success(`已从班级设备导入 ${list.length} 项（设备名，可再编辑）`);
		} catch (e) {
			error = "从班级设备导入失败：" + ((e as Error)?.message || String(e));
			toast.error("从班级设备导入失败");
		} finally {
			fromBusy = false;
		}
	}
</script>

<svelte:head>
	<title>随机抽取 · 课堂点名 | Stelarith</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-3xl p-4 md:p-6">
	<div class="mb-5 flex items-start justify-between gap-3">
		<div class="flex items-center gap-3">
			<div class="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
				<Dices class="size-5" />
			</div>
			<div>
				<h1 class="font-heading text-lg font-semibold">随机抽取 · 课堂点名</h1>
				<p class="text-xs text-muted-foreground">
					名单保存在本机浏览器（当前 {names.length} 人 · 未抽 {avail} 人）。开启「防重复」后抽过的人不再出现，可「重置已抽」重来。
				</p>
			</div>
		</div>
		<Button variant="outline" size="sm" href="/admin/console" class="shrink-0 gap-1.5">
			<ArrowLeft class="size-3.5" /> 回概览
		</Button>
	</div>

	<!-- 错误态：所有失败都给可读原因，绝不静默 -->
	{#if error}
		<div
			class="mb-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
		>
			<AlertTriangle class="mt-0.5 size-4 shrink-0" />
			<span>{error}</span>
		</div>
	{/if}

	<!-- 名单输入卡片 -->
	<div class="rounded-xl border border-border/60 bg-card p-4 shadow-sm md:p-5">
		<div class="mb-3 flex items-center gap-2 text-sm font-medium">
			<Users class="size-4 text-muted-foreground" /> 名单
		</div>
		<div class="grid gap-1.5">
			<Label for="random-input">粘贴名单（每行一个名字）</Label>
			<Textarea
				id="random-input"
				bind:value={input}
				rows={4}
				placeholder={"每行一个名字，例如：\n张三\n李四\n王五"}
			/>
		</div>
		<div class="mt-3 flex flex-wrap items-center gap-2">
			<Button onclick={importNames} class="gap-1.5"><Download class="size-4" /> 导入名单</Button>
			<Button variant="outline" onclick={fromClass} disabled={fromBusy} class="gap-1.5">
				{#if fromBusy}<Loader2 class="size-4 animate-spin" />{:else}<Download class="size-4" />{/if}
				从班级设备导入
			</Button>
			<Button variant="outline" onclick={clearList} class="gap-1.5">
				<Trash2 class="size-4" /> 清空名单
			</Button>
		</div>
		<p class="mt-2 text-xs text-muted-foreground">
			名单与历史只保存在这台电脑的浏览器里（localStorage），换设备/换浏览器不会同步；清理浏览器数据会一并清除。
		</p>
	</div>

	<!-- 抽取卡片 -->
	<div class="mt-4 rounded-xl border border-border/60 bg-card p-4 shadow-sm md:p-5">
		<div class="flex flex-wrap items-center gap-3">
			<Button
				size="lg"
				onclick={() => draw(1)}
				disabled={drawing || !names.length}
				class="gap-1.5"
			>
				<Shuffle class="size-4" /> 抽 1 人
			</Button>
			<span class="text-sm text-muted-foreground">抽</span>
			<input
				type="number"
				min="1"
				bind:value={count}
				class="h-9 w-16 rounded-md border border-input bg-background px-2 text-center text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
			/>
			<span class="text-sm text-muted-foreground">人</span>
			<Button variant="outline" onclick={drawN} disabled={drawing || !names.length}>抽取</Button>
			<label class="ml-1 flex cursor-pointer items-center gap-1.5 text-sm">
				<input type="checkbox" class="accent-primary" bind:checked={nodup} /> 防重复
			</label>
			<Button variant="ghost" onclick={resetDrawn} disabled={!drawn.length} class="gap-1.5">
				<RotateCcw class="size-4" /> 重置已抽
			</Button>
		</div>

		<!-- 结果区（四态：空 / 抽取中 / 有结果 / 已无可抽在下方错误条说明） -->
		<div
			class="mt-4 flex min-h-[64px] items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3 text-center"
		>
			{#if drawing}
				<span class="inline-flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2 class="size-4 animate-spin" /> 正在抽取…
				</span>
			{:else if lastBatch.length}
				<span class="text-lg font-semibold text-primary">🎲 {lastBatch.join("、")}</span>
			{:else if names.length}
				<span class="text-sm text-muted-foreground">点上面的按钮开始抽取</span>
			{:else}
				<span class="text-sm text-muted-foreground">还没有名单：先粘贴名单或用「从班级设备导入」</span>
			{/if}
		</div>
	</div>

	<!-- 历史 -->
	<div class="mt-4 rounded-xl border border-border/60 bg-card p-4 shadow-sm md:p-5">
		<div class="mb-3 flex items-center gap-2 text-sm font-medium">
			<ListChecks class="size-4 text-muted-foreground" /> 抽取历史（{history.length}）
		</div>
		{#if history.length}
			<div class="grid gap-2">
				{#each history as h, i (i)}
					<div class="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm">
						<b class="text-foreground">第 {i + 1} 批</b>：<span class="text-muted-foreground"
							>{h.join("、")}</span
						>
					</div>
				{/each}
			</div>
		{:else}
			<p class="text-sm text-muted-foreground">还没有抽取记录。导入名单后点「抽 1 人」试试。</p>
		{/if}
	</div>
</div>
