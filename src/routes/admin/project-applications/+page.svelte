<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Check, X, Rocket } from "@lucide/svelte";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();
	let apps = $state(data.apps);
	let makePage = $state(true);
	let busy = $state("");

	async function act(id: string, action: "approve" | "reject") {
		busy = id + action;
		try {
			const res = await fetch("/api/project-applications", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action, id, makePage })
			});
			if (res.ok) {
				const d = await res.json();
				apps = apps.map(a => (a.id === id ? d.app : a));
			}
		} finally { busy = ""; }
	}
</script>

<svelte:head><title>项目专页申请 | 后台</title></svelte:head>

<div class="flex flex-col gap-6">
	<div class="flex items-center justify-between">
		<h1 class="font-heading text-2xl font-semibold tracking-tight">项目专页申请</h1>
		<label class="flex items-center gap-2 text-sm text-muted-foreground">
			<input type="checkbox" bind:checked={makePage} class="size-4" /> 通过后生成专页
		</label>
	</div>

	{#if apps.length === 0}
		<p class="text-sm text-muted-foreground">暂无申请。</p>
	{:else}
		<div class="flex flex-col gap-3">
			{#each apps as a (a.id)}
				<div class="flex flex-col gap-2 rounded-xl border border-border/60 bg-card p-4">
					<div class="flex flex-wrap items-center gap-2">
						<span class="font-medium">{a.name}</span>
						<Badge variant={a.status === "pending" ? "secondary" : a.status === "approved" ? "default" : "outline"}>{a.status}</Badge>
						<span class="text-xs text-muted-foreground">by @{a.owner} · {a.createdAt?.slice(0, 10)}</span>
					</div>
					<p class="text-sm text-muted-foreground">{a.summary}</p>
					<div class="flex flex-wrap gap-3 text-xs text-muted-foreground">
						{#if a.repo}<span>仓库：{a.repo}</span>{/if}
						{#if a.website}<span>官网：{a.website}</span>{/if}
						{#if a.category}<span>分类：{a.category}</span>{/if}
					</div>
					{#if a.status === "pending"}
						<div class="flex justify-end gap-2">
							<Button variant="outline" size="sm" class="gap-1 text-destructive" disabled={busy === a.id + "reject"} onclick={() => act(a.id, "reject")}><X class="size-3.5" /> 拒绝</Button>
							<Button size="sm" class="gap-1" disabled={busy === a.id + "approve"} onclick={() => act(a.id, "approve")}><Check class="size-3.5" /> 通过</Button>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
