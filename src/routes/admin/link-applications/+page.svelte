<script lang="ts">
	import { onMount } from "svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Check, X, Link2 } from "@lucide/svelte";

	interface App { id: string; name: string; url: string; description?: string; email?: string; status: string; createdAt: string; }
	let apps = $state<App[]>([]);
	let loading = $state(true);
	let error = $state("");

	async function load() {
		loading = true;
		try {
			const res = await fetch("/api/link-applications");
			if (res.ok) { apps = await res.json(); }
			else { error = "加载失败"; }
		} catch (e) { error = "网络错误"; }
		loading = false;
	}

	async function act(id: string, action: string) {
		const res = await fetch("/api/link-applications", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ id, action })
		});
		if (res.ok) load();
	}

	onMount(load);
</script>

<div class="mb-6">
	<h1 class="text-2xl font-heading font-semibold">友链申请</h1>
	<p class="text-sm text-muted-foreground">审核友链申请，通过后自动加入友链列表</p>
</div>

{#if error}
	<p class="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
{/if}

{#if loading}
	<p class="text-muted-foreground">加载中...</p>
{:else if apps.length === 0}
	<div class="rounded-lg border border-dashed p-8 text-center text-muted-foreground">暂无申请</div>
{:else}
	<div class="max-w-2xl space-y-3">
		{#each apps as app (app.id)}
			<div class="rounded-lg border p-4">
				<div class="flex items-start justify-between gap-3">
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<Link2 class="size-4 shrink-0 text-primary" />
							<span class="truncate font-medium">{app.name}</span>
							{#if app.status === "pending"}<Badge variant="outline">待审核</Badge>{/if}
							{#if app.status === "approved"}<Badge>已通过</Badge>{/if}
							{#if app.status === "rejected"}<Badge variant="destructive">已拒绝</Badge>{/if}
						</div>
						<p class="mt-1 truncate text-xs text-muted-foreground">{app.url}</p>
						{#if app.description}<p class="mt-1 text-xs text-muted-foreground">{app.description}</p>{/if}
						<p class="mt-1 text-xs text-muted-foreground">提交于 {new Date(app.createdAt).toLocaleString()}</p>
					</div>
					{#if app.status === "pending"}
					<div class="flex shrink-0 items-center gap-1">
						<Button size="sm" onclick={() => act(app.id, "approve")}><Check class="h-3.5 w-3.5" /> 通过</Button>
						<Button size="sm" variant="outline" onclick={() => act(app.id, "reject")}><X class="h-3.5 w-3.5" /> 拒绝</Button>
					</div>
					{/if}
				</div>
			</div>
		{/each}
	</div>
{/if}