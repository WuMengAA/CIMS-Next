<script lang="ts">
	import { onMount } from "svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { MessageSquare } from "@lucide/svelte";

	let { target, user = null }: { target: string; user?: { username: string; role: string } | null } = $props();

	interface CommentItem { id: string; name: string; content: string; createdAt: string; parentId?: string; }
	let comments = $state<CommentItem[]>([]);
	let name = $state("");
	let body = $state("");
	let msg = $state("");
	let err = $state("");

	async function load() {
		try {
			const res = await fetch("/api/comments?target=" + encodeURIComponent(target));
			if (res.ok) comments = await res.json();
		} catch (e) { console.error(e); }
	}

	async function submit() {
		err = ""; msg = "";
		if (!body.trim()) { err = "评论内容不能为空"; return; }
		if (!user && !name.trim()) { err = "游客评论请填写昵称"; return; }
		try {
			const res = await fetch("/api/comments", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ target, name, content: body })
			});
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				body = "";
				msg = user ? "评论已发布" : "评论已提交，将在审核通过后显示";
				setTimeout(() => (msg = ""), 4000);
				if (user) load();
			} else {
				err = d.error || "发布失败";
			}
		} catch {
			err = "网络错误";
		}
	}

	onMount(load);
</script>

<section id="comments" class="mt-10">
	<h2 class="mb-4 flex items-center gap-2 font-heading text-xl font-semibold">
		<MessageSquare class="size-5 text-primary" />
		评论（{comments.length}）
	</h2>

	{#if comments.length > 0}
		<div class="mb-6 flex flex-col divide-y divide-border/40 rounded-xl border border-border/60 bg-card">
			{#each comments as c (c.id)}
				<div class="flex gap-3 p-4">
					<div class="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">{c.name.slice(0, 1).toUpperCase()}</div>
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<span class="text-sm font-medium">{c.name}</span>
							<span class="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</span>
						</div>
						<p class="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{c.content}</p>
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<p class="mb-6 text-sm text-muted-foreground">还没有评论，来抢沙发~</p>
	{/if}

	<div class="rounded-xl border border-border/60 bg-card p-4">
		<h3 class="mb-3 text-sm font-medium">发表评论</h3>
		{#if !user}
			<div class="mb-3">
				<input bind:value={name} placeholder="昵称（游客必填）" maxlength="50" class="h-9 w-full max-w-xs rounded-md border bg-background px-3 text-sm outline-none focus:border-primary/60" />
			</div>
		{:else}
			<p class="mb-3 text-xs text-muted-foreground">以 {user.username} 的身份发表（自动通过）</p>
		{/if}
		<textarea bind:value={body} rows={4} maxlength="2000" placeholder="说点什么吧…（支持纯文本）" class="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60"></textarea>
		{#if err}
			<p class="mt-2 text-xs text-destructive">{err}</p>
		{/if}
		{#if msg}
			<p class="mt-2 text-xs text-primary">{msg}</p>
		{/if}
		<div class="mt-3 flex justify-end">
			<Button onclick={submit} disabled={!body.trim() || (!user && !name.trim())}>发表评论</Button>
		</div>
	</div>
</section>
