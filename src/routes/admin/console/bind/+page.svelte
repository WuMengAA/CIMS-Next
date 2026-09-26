<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { toast } from "svelte-sonner";
	import { MonitorSmartphone, ShieldCheck, CornerDownRight, ArrowLeft, RefreshCw } from "@lucide/svelte";

	// 二次绑定引导页：进入集控面板前的「班级身份绑定」。
	// 2026-09-21 重构：班级改为**从真实班级列表里点选**（来源 /class/list，经集控代理），
	// 不再手填自由文本 —— 手填的「高一(3)班/信息中心」跟 CIMS 里的班级实体（3班/class_03）
	// 对不上，是「绑了班却看不到自己班设备、设备全堆一起」的根因。
	// 绑定写回的 className 直接用班级实体的正式班名，面板/代理按数字归一即可精确命中。
	let { data } = $props<{ data: { username: string; displayName: string; className: string; gradeName: string } }>();

	interface ClassOption {
		id: string;          // class_plan 资源名（API 语义 id）
		name: string;        // 人话班名，如「3班」
		code: string;        // 正式编号，如「2025届3班」（可能同 name）
		classId: string;     // 班级实体主键 class_01
		displayCode: string;
	}

	let classes = $state<ClassOption[]>([]);
	let loading = $state(true);
	let loadError = $state("");
	let className = $state("");
	let gradeName = $state("");
	let manual = $state(false);   // 班级列表为空时可手输
	let saving = $state(false);
	let error = $state("");

	async function loadClasses() {
		loading = true;
		loadError = "";
		try {
			const res = await fetch("/api/console/cims/class/list");
			const d = await res.json();
			if (!res.ok) { throw new Error(d.error || `HTTP ${res.status}`); }
			classes = (Array.isArray(d) ? d : []).map((c: Record<string, unknown>) => ({
				id: String(c.class_plan ?? c.id ?? ""),
				name: String(c.name ?? c.class_id ?? ""),
				code: String(c.code ?? c.display_code ?? c.name ?? ""),
				classId: String(c.class_id ?? ""),
				displayCode: String(c.display_code ?? c.name ?? "")
			}));
			// 已绑定的班名若在列表里 → 预选上；否则留空让用户选
			if (data.className) {
				const own = String(data.className).trim();
				const digit = (s: string) => (s.match(/\d+/g) || []).map((x) => String(Number(x))).join("");
				const hit = classes.find((c) => c.name === own || (digit(c.name) && digit(c.name) === digit(own)));
				if (hit) { className = hit.name; gradeName = data.gradeName || gradeFrom(hit); }
				else { className = own; gradeName = data.gradeName || ""; }
			}
		} catch (e) {
			loadError = (e as Error).message || "加载班级列表失败";
			manual = true; // 列表拿不到 → 允许手输，别把用户卡死
		} finally {
			loading = false;
		}
	}

	// 「2025届3班」→ 年级「2025届」；其余（如「3班」）→ 空，由用户补。
	function gradeFrom(c: ClassOption) {
		const m = (c.code || c.name).match(/^(\d+届)/);
		return m ? m[1] : "";
	}

	function onPick(v: string) {
		className = v;
		const hit = classes.find((c) => c.name === v);
		if (hit) { const g = gradeFrom(hit); if (g) gradeName = g; }
	}

	async function submit() {
		error = "";
		if (!className.trim()) {
			error = "请选择或填写班级（例如：3班）";
			return;
		}
		saving = true;
		try {
			const res = await fetch("/api/me", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ className: className.trim(), gradeName: gradeName.trim() })
			});
			const d = await res.json();
			if (res.ok && d.ok) {
				toast.success("班级绑定成功，正在进入集控面板…");
				window.location.href = "/admin/console";
				return;
			}
			error = d.error || "保存失败，请重试";
		} catch (e) {
			error = "网络错误，请重试";
		}
		saving = false;
	}
	loadClasses();
</script>

<svelte:head>
	<title>班级绑定 · 集控面板 | Stelarith</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="flex min-h-[60vh] items-center justify-center p-4">
	<div class="w-full max-w-md rounded-xl border border-border/60 bg-card p-6 shadow-sm">
		<div class="mb-1 flex size-11 items-center justify-center rounded-lg bg-primary/15 text-primary">
			<MonitorSmartphone class="size-5" />
		</div>
		<h1 class="mt-3 font-heading text-xl font-semibold">进入集控面板前，请选择你的班级</h1>
		<p class="mt-2 text-sm leading-relaxed text-muted-foreground">
			你好，<span class="font-medium text-foreground">{data.displayName}</span>（@{data.username}）。
			集控面板按班级给你定位设备，从下面列表里选你负责的班即可。
		</p>

		<div class="mt-5 flex flex-col gap-4">
			{#if loading}
				<div class="py-6 text-center text-sm text-muted-foreground">正在加载班级列表…</div>
			{:else if manual || classes.length === 0}
				<div class="grid gap-1.5">
					<Label for="class">班级</Label>
					<Input id="class" bind:value={className} placeholder="如：3班 / 2025届3班" onkeydown={(e) => { if (e.key === "Enter") submit(); }} />
					{#if loadError}<p class="text-xs text-destructive">班级列表加载失败：{loadError}（已改为手输）</p>{:else}<p class="text-xs text-muted-foreground">暂无可选班级，请手输班名（与学校正式班名一致）。</p>{/if}
				</div>
			{:else}
				<div class="grid gap-1.5">
					<Label for="class-pick">我的班级</Label>
					<select
						id="class-pick"
						value={className}
						onchange={(e) => onPick((e.target as HTMLSelectElement).value)}
						class="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
					>
						<option value="">（请选择班级）</option>
						{#each classes as c (c.classId || c.name)}
							<option value={c.name}>{c.name}{c.code && c.code !== c.name ? ` · ${c.code}` : ""}</option>
						{/each}
					</select>
					<p class="text-xs text-muted-foreground">若班里还没有你要的班级，请管理员在面板「班级管理」里新建，刷新后即可选择。</p>
				</div>
				<div class="grid gap-1.5">
					<Label for="grade">年级（选填）</Label>
					<Input id="grade" bind:value={gradeName} placeholder="如：高一 / 2025届" />
				</div>
			{/if}

			{#if error}
				<p class="text-sm text-destructive">{error}</p>
			{/if}

			<div class="flex items-center gap-2">
				<Button onclick={submit} disabled={saving || loading}>{saving ? "绑定中…" : "确认并进入面板"}</Button>
				<Button variant="outline" href="/admin" class="gap-1.5">
					<ArrowLeft class="size-3.5" /> 返回后台
				</Button>
			</div>
		</div>

		<div class="mt-6 flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
			<ShieldCheck class="mt-0.5 size-3.5 shrink-0 text-primary" />
			<p>绑定后侧栏「更多功能 → 账号」可随时更换班级。班级信息仅用于设备归属与权限范围判定，仅本人可见可改。</p>
			{#if manual}
				<button class="ml-1 inline-flex shrink-0 items-center gap-1 text-primary hover:underline" onclick={async () => { manual = false; await loadClasses(); }}>
					<RefreshCw class="size-3" /> 重试加载列表
				</button>
			{/if}
		</div>
	</div>
</div>