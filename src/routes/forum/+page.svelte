<script lang="ts">
	import Container from "$lib/components/container.svelte";
	import PageHeader from "$lib/components/page-header.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { MessageSquare, Plus, Lock } from "@lucide/svelte";

	let { data }: { data: { channels: any[]; threads: any[]; user?: { username: string; role: string } | null } } = $props();

	let newChannel = $state("");
	let newDesc = $state("");
	let chMsg = $state("");
	let chErr = $state("");
	let chSubmitting = $state(false);

	async function createChannel() {
		chErr = ""; chMsg = "";
		if (!newChannel.trim()) { chErr = "请填写频道名称"; return; }
		chSubmitting = true;
		try {
			const res = await fetch("/api/forum/channels", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: newChannel, description: newDesc })
			});
			if (res.ok) {
				const d = await res.json();
				window.location.href = "/forum/" + d.channel.slug;
			} else {
				chErr = (await res.json()).error || "创建失败";
			}
		} catch { chErr = "网络错误"; }
		chSubmitting = false;
	}
</script>

<svelte:head><title>论坛 | Stelarith</title></svelte:head>

<Container>
	<PageHeader title="论坛" description="自由交流、建立频道、分享想法。" />

	<div class="grid gap-6 md:grid-cols-3">
		<!-- 频道列表 -->
		<section class="md:col-span-2">
			<h2 class="mb-3 text-sm font-medium text-muted-foreground">频道</h2>
			{#if data.channels.length === 0}
				<p class="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">还没有频道，登录后创建第一个吧。</p>
			{:else}
				<div class="grid gap-3 sm:grid-cols-2">
					{#each data.channels as ch (ch.id)}
						<a href="/forum/{ch.slug}" class="flex flex-col gap-1 rounded-xl border border-border/60 bg-card p-4 transition-colors hover:border-primary/50">
							<span class="font-medium">{ch.name}</span>
							{#if ch.description}<span class="line-clamp-2 text-xs text-muted-foreground">{ch.description}</span>{/if}
							<span class="mt-1 text-xs text-muted-foreground">由 @{ch.owner} 创建</span>
						</a>
					{/each}
				</div>
			{/if}

			{#if data.user}
				<details class="mt-4 rounded-xl border border-border/60 bg-card p-4">
					<summary class="flex cursor-pointer items-center gap-2 text-sm font-medium"><Plus class="size-4" /> 创建频道</summary>
					<div class="mt-3 flex flex-col gap-3">
						<input bind:value={newChannel} maxlength="60" placeholder="频道名称" class="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary/60" />
						<input bind:value={newDesc} maxlength="300" placeholder="简介（可选）" class="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary/60" />
						{#if chErr}<p class="text-xs text-destructive">{chErr}</p>{/if}
						{#if chMsg}<p class="text-xs text-primary">{chMsg}</p>{/if}
						<div class="flex justify-end"><Button onclick={createChannel} disabled={chSubmitting}>{chSubmitting ? "创建中…" : "创建"}</Button></div>
					</div>
				</details>
			{/if}
		</section>

		<!-- 最新帖子 -->
		<section>
			<h2 class="mb-3 text-sm font-medium text-muted-foreground">最新帖子</h2>
			{#if data.threads.length === 0}
				<p class="text-sm text-muted-foreground">暂无帖子。</p>
			{:else}
				<div class="flex flex-col divide-y divide-border/40 rounded-xl border border-border/60 bg-card">
					{#each data.threads as t (t.id)}
						<a href="/forum/{t.channelSlug}/{t.id}" class="flex flex-col gap-1 p-3 transition-colors hover:bg-muted/40">
							<span class="line-clamp-1 text-sm font-medium">{t.pinned ? "📌 " : ""}{t.title}</span>
							<span class="flex items-center gap-2 text-xs text-muted-foreground">
								@{t.author} · {new Date(t.createdAt).toLocaleDateString()}
								{#if t.status === "locked"}<Lock class="size-3" />{/if}
							</span>
						</a>
					{/each}
				</div>
			{/if}
		</section>
	</div>
</Container>
