<script lang="ts">
	import Container from "$lib/components/container.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { ArrowLeft, Lock, Pin, Trash2, MessageSquare } from "@lucide/svelte";

	let { data }: {
		data: { thread: any; replies: any[]; channel: any; user?: { username: string; role: string } | null };
	} = $props();

	const isMod = $derived(["admin", "editor", "moderator"].includes(data.user?.role || ""));
	const locked = $derived(data.thread.status === "locked");

	let content = $state("");
	let err = $state("");
	let submitting = $state(false);

	async function reply() {
		err = "";
		if (!content.trim()) { err = "请填写回复内容"; return; }
		submitting = true;
		try {
			const res = await fetch("/api/forum/threads/" + data.thread.id, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ content })
			});
			if (res.ok) window.location.reload();
			else err = (await res.json()).error || "回复失败";
		} catch { err = "网络错误"; }
		submitting = false;
	}

	async function act(action: string) {
		await fetch("/api/forum/threads/" + data.thread.id, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action })
		});
		if (action === "delete") window.location.href = "/forum" + (data.channel ? "/" + data.channel.slug : "");
		else window.location.reload();
	}
</script>

<svelte:head><title>{data.thread.title} | 论坛</title></svelte:head>

<Container>
	<div class="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
		<a href="/forum" class="hover:text-foreground">论坛</a>
		{#if data.channel}><a href="/forum/{data.channel.slug}" class="hover:text-foreground">{data.channel.name}</a>{/if}
	</div>

	<article class="rounded-xl border border-border/60 bg-card p-5">
		<div class="mb-3 flex items-start justify-between gap-3">
			<h1 class="font-heading text-xl font-semibold tracking-tight">{data.thread.title}</h1>
			{#if isMod}
				<div class="flex shrink-0 items-center gap-1">
					{#if locked}
						<Button variant="ghost" size="icon" title="解锁" onclick={() => act("unlock")}><Lock class="size-4" /></Button>
					{:else}
						<Button variant="ghost" size="icon" title="锁定" onclick={() => act("lock")}><Lock class="size-4" /></Button>
					{/if}
					<Button variant="ghost" size="icon" title={data.thread.pinned ? "取消置顶" : "置顶"} onclick={() => act(data.thread.pinned ? "unpin" : "pin")}><Pin class="size-4" /></Button>
					<Button variant="ghost" size="icon" title="删除" class="text-destructive" onclick={() => act("delete")}><Trash2 class="size-4" /></Button>
				</div>
			{/if}
		</div>
		<div class="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
			<span>@{data.thread.author}</span>
			<span>· {new Date(data.thread.createdAt).toLocaleString()}</span>
			<span>· {data.thread.views} 浏览</span>
			{#if locked}<span class="inline-flex items-center gap-1 text-amber-500"><Lock class="size-3" /> 已锁定</span>{/if}
		</div>
		<p class="whitespace-pre-wrap text-sm leading-relaxed">{data.thread.body}</p>
	</article>

	<section class="mt-6">
		<h2 class="mb-3 flex items-center gap-2 text-sm font-medium"><MessageSquare class="size-4" /> 回复（{data.replies.length}）</h2>
		{#if data.replies.length === 0}
			<p class="text-sm text-muted-foreground">还没有回复。</p>
		{:else}
			<div class="flex flex-col gap-3">
				{#each data.replies as r (r.id)}
					<div class="flex gap-3 rounded-xl border border-border/40 bg-card p-3">
						<div class="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{r.author.slice(0, 1).toUpperCase()}</div>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2 text-xs text-muted-foreground"><span class="text-foreground">{r.author}</span> · {new Date(r.createdAt).toLocaleString()}</div>
							<p class="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{r.content}</p>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		{#if data.user}
			{#if locked}
				<p class="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-500">主题已锁定，暂不能回复。</p>
			{:else}
				<div class="mt-4 rounded-xl border border-border/60 bg-card p-4">
					<textarea bind:value={content} rows={3} maxlength="3000" placeholder="写下你的回复…" class="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60"></textarea>
					{#if err}<p class="mt-2 text-xs text-destructive">{err}</p>{/if}
					<div class="mt-3 flex justify-end"><Button onclick={reply} disabled={submitting}>{submitting ? "发送中…" : "回复"}</Button></div>
				</div>
			{/if}
		{:else}
			<p class="mt-4 text-sm text-muted-foreground"><a href="/admin/login" class="text-primary hover:underline">登录</a> 后参与讨论。</p>
		{/if}
	</section>
</Container>
