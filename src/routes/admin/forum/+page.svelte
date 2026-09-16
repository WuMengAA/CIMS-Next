<script lang="ts">
	import Container from "$lib/components/container.svelte";
	import PageHeader from "$lib/components/page-header.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Lock, Pin, Trash2 } from "@lucide/svelte";

	let { data }: { data: { threads: any[]; channels: any[] } } = $props();
	const chName = $derived(Object.fromEntries(data.channels.map(c => [c.id, c.name])));

	async function act(id: string, action: string) {
		await fetch("/api/forum/threads/" + id, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action })
		});
		window.location.reload();
	}
	const statusLabel = (s: string) => ({ published: "已发布", pending: "待审", rejected: "已拒", locked: "已锁定" })[s] || s;
</script>

<svelte:head><title>论坛管理 | 后台</title></svelte:head>

<Container>
	<PageHeader title="论坛管理" description="置顶、锁定或删除帖子。" />

	{#if data.threads.length === 0}
		<p class="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">还没有帖子。</p>
	{:else}
		<div class="flex flex-col divide-y divide-border/40 rounded-xl border border-border/60 bg-card">
			{#each data.threads as t (t.id)}
				<div class="flex items-center gap-3 p-3">
					<div class="min-w-0 flex-1">
						<div class="line-clamp-1 text-sm font-medium">{t.title}</div>
						<div class="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
							<span>@{t.author}</span>
							<span>· {chName[t.channelId] || t.channelId}</span>
							<Badge variant={t.status === "published" ? "default" : "outline"} class="text-[10px]">{statusLabel(t.status)}</Badge>
						</div>
					</div>
					<div class="flex shrink-0 items-center gap-1">
						<Button variant="ghost" size="icon" title={t.status === "locked" ? "解锁" : "锁定"} onclick={() => act(t.id, t.status === "locked" ? "unlock" : "lock")}><Lock class="size-4" /></Button>
						<Button variant="ghost" size="icon" title={t.pinned ? "取消置顶" : "置顶"} onclick={() => act(t.id, t.pinned ? "unpin" : "pin")}><Pin class="size-4" /></Button>
						<Button variant="ghost" size="icon" title="删除" class="text-destructive" onclick={() => act(t.id, "delete")}><Trash2 class="size-4" /></Button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</Container>
