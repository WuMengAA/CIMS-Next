<script lang="ts">
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "$lib/components/ui/card/index.js";
	import { Settings2, Save, RefreshCw, CheckCircle2, AlertTriangle } from "@lucide/svelte";

	// ClassIsland 配置下发（2026-10-19 迁移自旧 static/console 的 config 视图）。
	// 数据源：CIMS「default_components」Components 资源（唯一一张真实组件资源），
	// 浏览器一律经 /api/console/cims 服务端代理（凭据在服务端、权限在代理闸门），
	// 绝不直连 CIMS 或携带管理令牌。
	//
	//   · 读  GET  /api/console/cims/v1/client/Components?name=default_components
	//   · 写  POST /api/console/cims/account/{slug}/Components/write?name=default_components
	//        （需 manage 档：代理在服务端裁决，越权返回 403 + 人话文案）
	//   · slug 取 /api/console/cims/account/list 首账户（单租户惯例，与代理 acquireSlug 同口径）
	//
	// ⚠️ 铁律：写接口 HTTP 200 不代表成功 —— 保存后必须读回执体判 ok。

	const RESOURCE = "default_components";

	let autoHideIn = $state(true);   // 上课自动隐藏
	let autoHideExam = $state(true); // 考试自动隐藏
	let autoHideProj = $state(true); // 投影时自动隐藏
	let updateChannel = $state("");
	let rawJson = $state("");
	let rawValid = $state(true);
	let loading = $state(true);
	let loaded = $state(false);
	let saving = $state(false);
	let slug = $state("");

	/** 读取配置：先把 JSON 区域与三个开关、更新通道一起刷成服务端现值。 */
	async function load() {
		loading = true;
		try {
			const r = await fetch(`/api/console/cims/v1/client/Components?name=${RESOURCE}`);
			const j = await r.json();
			if (!r.ok) {
				toast.error(j.error ?? `加载配置失败（HTTP ${r.status}）`);
				loaded = false;
				return;
			}
			const c = (j && typeof j === "object" ? j : {}) as Record<string, any>;
			autoHideIn = Boolean(c.autoHide?.inClass);
			autoHideExam = Boolean(c.autoHide?.exam);
			autoHideProj = Boolean(c.autoHide?.projection);
			updateChannel = String(c.updateChannel ?? "");
			rawJson = JSON.stringify(c, null, 2);
			rawValid = true;
			loaded = true;
		} catch {
			toast.error("加载配置失败（CIMS 代理不可用？）");
			loaded = false;
		} finally {
			loading = false;
		}
	}

	/** 首次进页时拿写路径需要的账户 slug（与代理 acquireSlug 单租户口径一致）。 */
	onMount(async () => {
		try {
			const r = await fetch("/api/console/cims/account/list");
			if (r.ok) {
				const list = (await r.json()) as Array<{ slug?: string }>;
				if (Array.isArray(list) && list.length) slug = String(list[0].slug ?? "");
			}
		} catch {
			/* slug 拿不到只影响保存，读取与展示不受影响 */
		}
		await load();
	});

	/** 把表单三个开关 + 更新通道合并回 JSON 区；JSON 不合法时给出明确报错。 */
	function syncFormToJson(): boolean {
		let obj: Record<string, unknown>;
		try {
			obj = JSON.parse(rawJson || "{}");
		} catch {
			rawValid = false;
			toast.error("原始配置不是合法 JSON，无法保存");
			return false;
		}
		rawValid = true;
		obj.autoHide = { inClass: autoHideIn, exam: autoHideExam, projection: autoHideProj };
		obj.updateChannel = updateChannel;
		rawJson = JSON.stringify(obj, null, 2);
		return true;
	}

	async function save() {
		if (!slug) {
			toast.error("未取得账户 slug，保存不可用（检查 CIMS 代理）");
			return;
		}
		if (!syncFormToJson()) return;
		saving = true;
		try {
			const body = JSON.parse(rawJson) as unknown;
			const r = await fetch(
				`/api/console/cims/account/${encodeURIComponent(slug)}/Components/write?name=${RESOURCE}`,
				{ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
			);
			const j = (await r.json().catch(() => ({}))) as { ok?: unknown; error?: string };
			if (!r.ok || j.ok !== true) {
				toast.error(j.error ?? `保存未确认（HTTP ${r.status}，回执未置 ok）`);
				return;
			}
			toast.success("配置已保存并下发（教室机下次拉取生效）");
		} catch {
			toast.error("保存失败（CIMS 代理不可用？）");
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>ClassIsland 配置 · 集控面板 | Stelarith</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<h2 class="text-xl font-bold flex items-center gap-2"><Settings2 class="size-5" /> ClassIsland 配置下发</h2>
		<p class="text-sm text-muted-foreground mt-1">资源 default_components · 经服务端代理拉取与下发 · 对所有设备生效</p>
	</div>

	{#if loading}
		<div class="text-sm text-muted-foreground flex items-center gap-2">
			<RefreshCw class="size-4 animate-spin" /> 加载中…
		</div>
	{:else if !loaded}
		<div class="rounded-lg border border-dashed p-6 text-sm flex items-center gap-2 text-muted-foreground">
			<AlertTriangle class="size-4" /> 配置加载失败：CIMS 代理未就绪或无权限（<code class="text-foreground">/api/console/cims</code> 返回错误）。
			<Button variant="outline" size="sm" onclick={load} class="ml-auto">重试</Button>
		</div>
	{:else}
		<Card>
			<CardHeader>
				<CardTitle>自动隐藏策略</CardTitle>
				<CardDescription>教室大屏在哪些场景下自动隐藏 ClassIsland 浮层</CardDescription>
			</CardHeader>
			<CardContent class="space-y-3">
				<label class="flex items-center gap-2 text-sm cursor-pointer">
					<input type="checkbox" bind:checked={autoHideIn} class="size-4 accent-primary" />
					上课自动隐藏
				</label>
				<label class="flex items-center gap-2 text-sm cursor-pointer">
					<input type="checkbox" bind:checked={autoHideExam} class="size-4 accent-primary" />
					考试自动隐藏
				</label>
				<label class="flex items-center gap-2 text-sm cursor-pointer">
					<input type="checkbox" bind:checked={autoHideProj} class="size-4 accent-primary" />
					投影时自动隐藏
				</label>
			</CardContent>
		</Card>

		<Card>
			<CardHeader>
				<CardTitle>更新通道</CardTitle>
				<CardDescription>设备端 ClassIsland 更新的来源标识（留空表示默认通道）</CardDescription>
			</CardHeader>
			<CardContent>
				<Input bind:value={updateChannel} placeholder="如 stable / beta" />
			</CardContent>
		</Card>

		<Card>
			<CardHeader>
				<CardTitle>原始配置</CardTitle>
				<CardDescription>完整 JSON（可远程改视图/组件/策略）；保存时把上方表单值合并进去</CardDescription>
			</CardHeader>
			<CardContent class="space-y-3">
				<textarea
					bind:value={rawJson}
					rows="12"
					spellcheck="false"
					class:border-destructive={!rawValid}
					class="w-full rounded-md border border-border/60 bg-background px-3 py-2 font-mono text-[13px] leading-relaxed outline-none focus:ring-2 focus:ring-primary/30 resize-y"
				></textarea>
				{#if !rawValid}
					<p class="text-xs text-destructive">JSON 不合法，请修正后再保存。</p>
				{/if}
				<p class="text-xs text-muted-foreground flex items-center gap-1">
					<CheckCircle2 class="size-3.5" />
					保存需「设备管理」权限（manage），越权时服务端会直接拒绝并提示。
				</p>
			</CardContent>
		</Card>

		<div class="flex gap-2">
			<Button onclick={save} disabled={saving || !slug}>
				{#if saving}<RefreshCw class="size-4 animate-spin" />{:else}<Save class="size-4" />{/if}
				保存并下发
			</Button>
			<Button variant="outline" onclick={load} disabled={loading}>重新拉取</Button>
		</div>
	{/if}
</div>
