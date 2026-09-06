<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { MessageSquare, Check, Trash2, Loader2 } from "@lucide/svelte";
	import { toast } from "svelte-sonner";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();
	let loading = $state(false);

	async function toggle(id: string) {
		loading = true;
		try {
			const res = await fetch("/api/comments", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "toggle", id })
			});
			if (res.ok) await invalidateAll();
			else toast.error("操作失败");
		} catch {
			toast.error("网络错误");
		}
		loading = false;
	}
	async function remove(id: string) {
		if (!confirm("删除这条评论？")) return;
		loading = true;
		try {
			const res = await fetch("/api/comments", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "delete", id })
			});
			if (res.ok) await invalidateAll();
			else toast.error("删除失败");
		} catch {
			toast.error("网络错误");
		}
		loading = false;
	}
	const targetLabel = (t: string) => t.replace(":", " / ");
</script>

<svelte:head><title>评论审核 | Stelarith</title><meta name="robots" content="noindex" /></svelte:head>

<div class="mb-6 flex items-center justify-between">
	<div>
		<h1 class="text-2xl font-heading font-semibold">评论审核</h1>
		<p class="text-sm text-muted-foreground">游客评论默认待审核，登录用户评论自动通过</p>
	</div>
	<Badge variant="outline">共 {data.comments.length} 条</Badge>
</div>

{#if data.comments.length === 0}
	<div class="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">暂无评论</div>
{:else}
	<div class="space-y-3">
		{#each data.comments as c (c.id)}
			<div class="rounded-xl border border-border/60 bg-card p-4">
				<div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
					<MessageSquare class="size-3.5" />
					<span class="font-medium text-foreground">{c.name}</span>
					{#if c.author}<Badge variant="secondary" class="text-[10px]">注册用户</Badge>{/if}
					<span>· {targetLabel(c.target)}</span>
					<span>· {new Date(c.createdAt).toLocaleString()}</span>
					{#if c.approved}
						<Badge class="gap-1 text-[10px]"><Check class="size-3" />已通过</Badge>
					{:else}
						<Badge variant="outline" class="gap-1 text-[10px]">待审核</Badge>
					{/if}
					<div class="ml-auto flex items-center gap-1">
						<Button size="sm" variant="outline" disabled={loading} onclick={() => toggle(c.id)}>
							{c.approved ? "撤回" : "通过"}
						</Button>
						<Button size="sm" variant="ghost" class="text-destructive hover:text-destructive" disabled={loading} onclick={() => remove(c.id)}>
							<Trash2 class="size-3.5" />
						</Button>
					</div>
				</div>
				<p class="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{c.content}</p>
			</div>
		{/each}
	</div>
{/if}
