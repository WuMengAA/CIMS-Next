<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Select } from "$lib/components/ui/select/index.js";
	import { Rss, Plus, Trash2, Copy, RefreshCw, Check, Loader2 } from "@lucide/svelte";
	import { toast } from "svelte-sonner";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	type Source = { id: string; name: string; url: string; category: string; enabled: boolean; maxItems: number };
	type Settings = {
		includeAnnouncementsInBroadcast: boolean;
		includePostsInBroadcast: boolean;
		includeNewsInBroadcast: boolean;
		maxPostsInBroadcast: number;
		maxNewsItems: number;
		newsWindowDays: number;
		broadcastSeverity: number;
	};

	let sources = $state<Source[]>(data.config.sources.map((s: Source) => ({ ...s })));
	let settings = $state<Settings>({ ...data.config.settings });

	let saving = $state(false);
	let refreshing = $state(false);
	let endpointCopied = $state(false);

	const SEVERITIES = [
		{ value: "0", label: "一般 (0)" },
		{ value: "1", label: "重要 (1)" },
		{ value: "2", label: "紧急 (2)" }
	];

	function addSource() {
		sources = [
			...sources,
			{ id: "src-" + Date.now().toString(36), name: "", url: "", category: "综合", enabled: true, maxItems: 10 }
		];
	}
	function removeSource(id: string) {
		sources = sources.filter((s) => s.id !== id);
	}

	async function save() {
		// 基本校验：启用项必须有合法 URL
		const bad = sources.filter((s) => s.enabled && !/^https?:\/\//.test(s.url));
		if (bad.length) {
			toast.error("启用的源必须填写 http(s) 开头的地址：" + bad.map((b) => b.name || "(未命名)").join("、"));
			return;
		}
		saving = true;
		try {
			const res = await fetch("/api/feed-config", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ sources, settings })
			});
			if (res.ok) {
				toast.success("已保存");
				await invalidateAll();
			} else {
				const d = await res.json().catch(() => ({}));
				toast.error(d.error || "保存失败");
			}
		} catch {
			toast.error("网络错误");
		}
		saving = false;
	}

	async function refreshCache() {
		refreshing = true;
		try {
			const res = await fetch("/api/feed-config/refresh", { method: "POST" });
			const d = await res.json().catch(() => ({}));
			if (res.ok) toast.success("已刷新聚合缓存（" + (d.count ?? 0) + " 条）");
			else toast.error(d.error || "刷新失败");
		} catch {
			toast.error("网络错误");
		}
		refreshing = false;
	}

	async function copyEndpoint() {
		const url = location.origin + "/api/classisland/announcements";
		try {
			await navigator.clipboard.writeText(url);
			endpointCopied = true;
			setTimeout(() => (endpointCopied = false), 2000);
		} catch {
			toast.error("复制失败，请手动复制");
		}
	}
</script>

<svelte:head><title>订阅源与播报 | Stelarith</title><meta name="robots" content="noindex" /></svelte:head>

<div class="mb-6 flex items-center justify-between">
	<div>
		<h1 class="text-2xl font-heading font-semibold">订阅源与播报</h1>
		<p class="text-sm text-muted-foreground">聚合知名新闻源，并推送到 ClassIsland 大屏播报</p>
	</div>
	<div class="flex gap-2">
		<Button variant="outline" onclick={refreshCache} disabled={refreshing}>
			{#if refreshing}<Loader2 class="size-4 mr-1 animate-spin" />{:else}<RefreshCw class="size-4 mr-1" />{/if}
			刷新聚合缓存
		</Button>
		<Button onclick={save} disabled={saving}><Rss class="size-4 mr-1" /> 保存配置</Button>
	</div>
</div>

<!-- ClassIsland 播报端点 -->
<div class="mb-6 rounded-xl border border-border/60 bg-card p-5">
	<div class="mb-2 flex items-center gap-2">
		<Rss class="size-4 text-primary" />
		<h2 class="font-heading text-base font-medium">ClassIsland 播报端点</h2>
	</div>
	<p class="mb-3 text-sm text-muted-foreground">
		在 ClassIsland → 设置 → 通知 → Web 公告源，填入下方地址即可让大屏自动拉取「站点公告 + 最新文章 + 聚合新闻」进行播报。
	</p>
	<div class="flex items-center gap-2">
		<code class="flex-1 overflow-x-auto rounded-md border border-border/60 bg-muted px-3 py-2 text-xs">{location.origin}/api/classisland/announcements</code>
		<Button variant="outline" size="sm" onclick={copyEndpoint}>
			{#if endpointCopied}<Check class="size-3.5" />{:else}<Copy class="size-3.5" />{/if}
			复制
		</Button>
	</div>
</div>

<!-- 播报设置 -->
<div class="mb-6 rounded-xl border border-border/60 bg-card p-5">
	<h2 class="mb-3 font-heading text-base font-medium">播报内容设置</h2>
	<div class="grid gap-4 sm:grid-cols-2">
		<label class="flex items-center gap-2 text-sm">
			<input type="checkbox" bind:checked={settings.includeAnnouncementsInBroadcast} class="size-4" /> 推送站点公告
		</label>
		<label class="flex items-center gap-2 text-sm">
			<input type="checkbox" bind:checked={settings.includePostsInBroadcast} class="size-4" /> 推送最新博客文章
		</label>
		<label class="flex items-center gap-2 text-sm">
			<input type="checkbox" bind:checked={settings.includeNewsInBroadcast} class="size-4" /> 推送聚合新闻
		</label>
		<div class="grid gap-1.5">
			<label class="text-sm font-medium">新闻/文章严重级别</label>
			<Select.Root type="single" bind:value={settings.broadcastSeverity}>
				<Select.Trigger class="w-full">{SEVERITIES.find((s) => String(s.value) === String(settings.broadcastSeverity))?.label ?? settings.broadcastSeverity}</Select.Trigger>
				<Select.Content>
					{#each SEVERITIES as s (s.value)}<Select.Item value={s.value} label={s.label} />{/each}
				</Select.Content>
			</Select.Root>
		</div>
		<div class="grid gap-1.5">
			<label class="text-sm font-medium">推送文章数（{settings.maxPostsInBroadcast}）</label>
			<Input type="number" min="0" max="50" bind:value={settings.maxPostsInBroadcast} />
		</div>
		<div class="grid gap-1.5">
			<label class="text-sm font-medium">推送新闻条数（{settings.maxNewsItems}）</label>
			<Input type="number" min="0" max="50" bind:value={settings.maxNewsItems} />
		</div>
		<div class="grid gap-1.5">
			<label class="text-sm font-medium">内容有效期（天，{settings.newsWindowDays}）</label>
			<Input type="number" min="1" max="60" bind:value={settings.newsWindowDays} />
		</div>
	</div>
</div>

<!-- 订阅源列表 -->
<div class="rounded-xl border border-border/60 bg-card p-5">
	<div class="mb-3 flex items-center justify-between">
		<h2 class="font-heading text-base font-medium">新闻订阅源（{sources.length}）</h2>
		<Button variant="outline" size="sm" onclick={addSource}><Plus class="size-3.5 mr-1" /> 添加源</Button>
	</div>

	{#if sources.length === 0}
		<div class="rounded-lg border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">还没有订阅源，点「添加源」开始聚合吧。</div>
	{:else}
		<div class="space-y-3">
			{#each sources as s, i (s.id)}
				<div class="grid grid-cols-1 gap-3 rounded-lg border border-border/50 p-3 sm:grid-cols-[auto_1fr_1fr_140px_44px] sm:items-center">
					<label class="flex items-center gap-1.5 text-xs text-muted-foreground" title="启用后参与聚合">
						<input type="checkbox" bind:checked={s.enabled} class="size-4" /> 启用
					</label>
					<div class="grid gap-1">
						<span class="text-[10px] text-muted-foreground">名称</span>
						<Input bind:value={s.name} placeholder="源名称" />
					</div>
					<div class="grid gap-1">
						<span class="text-[10px] text-muted-foreground">RSS/Atom 地址</span>
						<Input bind:value={s.url} placeholder="https://example.com/feed" />
					</div>
					<div class="grid grid-cols-2 gap-2">
						<div class="grid gap-1">
							<span class="text-[10px] text-muted-foreground">分类</span>
							<Input bind:value={s.category} placeholder="综合" />
						</div>
						<div class="grid gap-1">
							<span class="text-[10px] text-muted-foreground">条数</span>
							<Input type="number" min="1" max="50" bind:value={s.maxItems} />
						</div>
					</div>
					<Button variant="ghost" size="sm" class="text-destructive hover:text-destructive" onclick={() => removeSource(s.id)} title="删除">
						<Trash2 class="size-4" />
					</Button>
				</div>
			{/each}
		</div>
	{/if}
</div>
