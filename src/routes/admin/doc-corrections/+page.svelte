<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Check, X, MessageSquareWarning } from "@lucide/svelte";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();
	let corrections = $state(data.corrections);
	let busy = $state("");

	async function act(id: string, action: "approve" | "reject") {
		busy = id + action;
		try {
			const res = await fetch("/api/doc-corrections", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action, id })
			});
			if (res.ok) {
				const d = await res.json();
				corrections = corrections.map(c => (c.id === id ? d.correction : c));
			}
		} finally { busy = ""; }
	}
</script>

<svelte:head><title>文档纠错 | 后台</title></svelte:head>

<div class="flex flex-col gap-6">
	<h1 class="font-heading text-2xl font-semibold tracking-tight">文档纠错审核</h1>

	{#if corrections.length === 0}
		<p class="text-sm text-muted-foreground">暂无纠错提交。</p>
	{:else}
		<div class="flex flex-col gap-3">
			{#each corrections as c (c.id)}
				<div class="flex flex-col gap-2 rounded-xl border border-border/60 bg-card p-4">
					<div class="flex flex-wrap items-center gap-2">
						<a href="/docs/{c.docSlug}" class="font-medium hover:text-primary">/docs/{c.docSlug}</a>
						<Badge variant={c.status === "pending" ? "secondary" : c.status === "approved" ? "default" : "outline"}>{c.status}</Badge>
						<span class="text-xs text-muted-foreground">by @{c.author} · {c.createdAt?.slice(0, 10)}</span>
					</div>
					{#if c.section}<p class="text-xs text-muted-foreground">章节：{c.section}</p>{/if}
					{#if c.original}<p class="text-sm"><span class="text-destructive">原文：</span>{c.original}</p>{/if}
					<p class="text-sm"><span class="text-primary">建议：</span>{c.suggestion}</p>
					{#if c.note}<p class="text-xs text-muted-foreground">说明：{c.note}</p>{/if}
					{#if c.status === "pending"}
						<div class="flex justify-end gap-2">
							<Button variant="outline" size="sm" class="gap-1 text-destructive" disabled={busy === c.id + "reject"} onclick={() => act(c.id, "reject")}><X class="size-3.5" /> 拒绝</Button>
							<Button size="sm" class="gap-1" disabled={busy === c.id + "approve"} onclick={() => act(c.id, "approve")}><Check class="size-3.5" /> 通过</Button>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
