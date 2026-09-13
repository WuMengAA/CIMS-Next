<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import { RefreshCw, CircleCheck, CircleX } from "@lucide/svelte";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();
	let services = $state<any[]>(data.services);
	let checkedAt = $state(data.checkedAt);
	let refreshing = $state(false);

	async function refresh() {
		refreshing = true;
		try {
			const res = await fetch("/api/health");
			if (res.ok) {
				const d = await res.json();
				services = d.services;
				checkedAt = d.checkedAt;
			}
		} catch (e) {
			console.error(e);
		}
		refreshing = false;
	}

	function fmtTime(t: string): string {
		try {
			return new Date(t).toLocaleString("zh-CN");
		} catch {
			return t;
		}
	}
</script>

<div class="mb-6 flex items-center justify-between">
	<div>
		<h1 class="text-2xl font-heading font-semibold">服务存活状态</h1>
		<p class="text-sm text-muted-foreground">内部 API / 服务的存活探测（响应耗时 + 最近探测时间）</p>
	</div>
	<Button onclick={refresh} disabled={refreshing}>
		<RefreshCw class="h-4 w-4 mr-2 {refreshing ? 'animate-spin' : ''}" />
		{refreshing ? "探测中..." : "重新探测"}
	</Button>
</div>

<div class="overflow-x-auto rounded-lg border">
	<div class="grid min-w-[640px] grid-cols-[1.4fr_1.4fr_0.8fr_1.2fr] gap-2 border-b px-4 py-2 text-xs font-medium text-muted-foreground">
		<span>服务</span><span>地址</span><span>状态</span><span>耗时 / 信息</span>
	</div>
	{#each services as s (s.url)}
		<div class="grid min-w-[640px] grid-cols-[1.4fr_1.4fr_0.8fr_1.2fr] items-center gap-2 border-b px-4 py-3 text-sm last:border-b-0">
			<div class="font-medium">{s.name}</div>
			<div class="truncate text-muted-foreground">{s.url}</div>
			<div>
				{#if s.alive}
					<span class="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-500">
						<CircleCheck class="size-3" /> 存活
					</span>
				{:else}
					<span class="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive">
						<CircleX class="size-3" /> 异常
					</span>
				{/if}
			</div>
			<div class="text-xs text-muted-foreground">
				{#if s.ms !== null}{s.ms} ms{:else}—{/if}
				{#if s.status !== null && s.status !== undefined}<span> · HTTP {s.status}</span>{/if}
				{#if s.error}<span class="text-destructive"> · {s.error}</span>{/if}
			</div>
		</div>
	{/each}
</div>

<p class="mt-4 text-xs text-muted-foreground">
	最近探测：{fmtTime(checkedAt)} · 探测超时 3 秒；端点可在部署环境通过 HEALTH_ENDPOINTS（JSON 数组 [{name,url}]）自定义。
</p>
