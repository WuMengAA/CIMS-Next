<script lang="ts">
	import Container from "$lib/components/container.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { ArrowLeft, Lock, MessageSquare } from "@lucide/svelte";

	let { data }: { data: { channel: any; threads: any[]; user?: { username: string; role: string } | null } } = $props();

	let title = $state("");
	let body = $state("");
	let err = $state("");
	let msg = $state("");
	let submitting = $state(false);

	async function post() {
		err = ""; msg = "";
		if (!title.trim() || !body.trim()) { err = "请填写标题与内容"; return; }
		submitting = true;
		try {
			const res = await fetch("/api/forum/threads", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ channelId: data.channel.id, title, body })
			});
			if (res.ok) {
				const d = await res.json();
				window.location.href = "/forum/" + data.channel.slug + "/" + d.thread.id;
			} else {
				err = (await res.json()).error || "发布失败";
			}
		} catch { err = "网络错误"; }
		submitting = false;
	}
</script>

<svelte:head><title>{data.channel.name} | 论坛</title></svelte:head>

<Container>
	<a href="/forum" class="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft class="size-4" /> 返回论坛</a>

	<header class="mb-6">
		<h1 class="font-heading text-2xl font-semibold tracking-tight">{data.channel.name}</h1>
		{#if data.channel.description}<p class="mt-1 text-sm text-muted-foreground">{data.channel.description}</p>{/if}
	</header>

	{#if data.user}
		<details class="mb-6 rounded-xl border border-border/60 bg-card p-4">
			<summary class="flex cursor-pointer items-center gap-2 text-sm font-medium"><MessageSquare class="size-4" /> 发布新帖</summary>
			<div class="mt-3 flex flex-col gap-3">
				<input bind:value={title} maxlength="120" placeholder="标题" class="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary/60" />
				<textarea bind:value={body} rows={5} maxlength="5000" placeholder="说点什么…" class="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60"></textarea>
				{#if err}<p class="text-xs text-destructive">{err}</p>{/if}
				{#if msg}<p class="text-xs text-primary">{msg}</p>{/if}
				<div class="flex justify-end"><Button onclick={post} disabled={submitting}>{submitting ? "发布中…" : "发布"}</Button></div>
			</div>
		</details>
	{/if}

	{#if data.threads.length === 0}
		<p class="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">该频道还没有帖子，来发第一帖吧。</p>
	{:else}
		<div class="flex flex-col divide-y divide-border/40 rounded-xl border border-border/60 bg-card">
			{#each data.threads as t (t.id)}
				<a href="/forum/{data.channel.slug}/{t.id}" class="flex flex-col gap-1 p-4 transition-colors hover:bg-muted/40">
					<span class="line-clamp-1 font-medium">{t.pinned ? "📌 " : ""}{t.title}{#if t.status === "locked"} <Lock class="inline size-3" />{/if}</span>
					<span class="flex items-center gap-2 text-xs text-muted-foreground">
						@{t.author} · {new Date(t.createdAt).toLocaleDateString()} · {t.views} 浏览
					</span>
					{#if t.excerpt}<span class="line-clamp-2 text-xs text-muted-foreground">{t.excerpt}</span>{/if}
				</a>
			{/each}
		</div>
	{/if}
</Container>
