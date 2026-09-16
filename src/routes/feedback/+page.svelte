<script lang="ts">
	import { page } from "$app/state";
	import PageHero from "$lib/components/page-hero.svelte";
	import { MessageSquare, Send, CheckCircle2, CircleDot, CircleCheck, CircleSlash, MessageSquareReply } from "@lucide/svelte";
	import { Card } from "$lib/components/ui/card/index.js";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Textarea } from "$lib/components/ui/textarea/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";

	type Fb = {
		id: string;
		title: string;
		content: string;
		author: string;
		authorRole?: string;
		status: "open" | "planned" | "done" | "wontfix";
		labels?: string[];
		replies?: { author: string; content: string }[];
		createdAt?: string;
	};

	let title = $state("");
	let content = $state("");
	let labels = $state("");
	let submitting = $state(false);
	let error = $state("");
	let done = $state(false);
	let list = $state<{ items: Fb[] }>({ items: [] });

	const user = $derived((page.data as any)?.user ?? null);
	const STATUS_META: Record<string, { label: string; cls: string; icon: any }> = {
		open: { label: "待处理", cls: "bg-amber-500/15 text-amber-600", icon: CircleDot },
		planned: { label: "已采纳", cls: "bg-blue-500/15 text-blue-600", icon: CircleCheck },
		done: { label: "已完成", cls: "bg-emerald-500/15 text-emerald-600", icon: CheckCircle2 },
		wontfix: { label: "暂不处理", cls: "bg-zinc-500/15 text-zinc-500", icon: CircleSlash }
	};

	async function load() {
		try {
			const r = await fetch("/api/feedback");
			if (r.ok) list = await r.json();
		} catch {}
	}

	async function submit() {
		error = "";
		if (!title.trim() || !content.trim()) {
			error = "标题与内容不能为空";
			return;
		}
		submitting = true;
		try {
			const r = await fetch("/api/feedback", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					title: title.trim(),
					content: content.trim(),
					labels: labels.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean)
				})
			});
			const j = await r.json();
			if (!r.ok) {
				error = j.error || "提交失败";
			} else {
				done = true;
				title = "";
				content = "";
				labels = "";
				await load();
			}
		} finally {
			submitting = false;
		}
	}

	load();
</script>

<svelte:head>
	<title>反馈 | Stelarith</title>
</svelte:head>

<PageHero icon={MessageSquare} title="反馈" desc="意见、建议与 Bug 反馈。提交后公开可见，官方会在此跟进状态。" />

<div class="mx-auto grid max-w-5xl gap-6 px-4 py-8 md:grid-cols-[minmax(0,360px)_1fr]">
	<!-- 提交卡片 -->
	<div class="space-y-3">
		<Card class="p-4">
			{#if !user}
				<div class="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
					<p class="mb-2">登录后即可提交反馈</p>
					<Button href="/admin/login" size="sm" class="gap-1.5"><MessageSquare class="size-4" />去登录</Button>
				</div>
			{:else}
				<h3 class="mb-3 flex items-center gap-2 font-heading text-base font-semibold">
					<Send class="size-4 text-primary" />提交反馈
				</h3>
				{#if done}
					<div class="flex items-center gap-2 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-600">
						<CheckCircle2 class="size-4" />已提交，感谢你的反馈！
					</div>
				{/if}
				<div class="space-y-2">
					<Input bind:value={title} placeholder="一句话标题" />
					<Textarea bind:value={content} placeholder="详细描述你的建议或遇到的问题…" rows={5} />
					<Input bind:value={labels} placeholder="标签（用空格或逗号分隔，可选）" />
					{#if error}<p class="text-xs text-destructive">{error}</p>{/if}
					<Button onclick={submit} disabled={submitting} class="w-full gap-1.5">
						<Send class="size-4" />{submitting ? "提交中…" : "提交反馈"}
					</Button>
				</div>
			{/if}
		</Card>
	</div>

	<!-- 公开列表 -->
	<div class="space-y-3">
		<h3 class="font-heading text-base font-semibold">反馈列表</h3>
		{#if list.items.length === 0}
			<p class="text-sm text-muted-foreground">暂无反馈，来做第一个吧。</p>
		{/if}
		{#each list.items as fb (fb.id)}
			{@const st = STATUS_META[fb.status] ?? STATUS_META.open}
			<Card class="p-4">
				<div class="mb-1 flex flex-wrap items-center gap-2">
					<span class="font-medium">{fb.title}</span>
					<Badge class="{st.cls} border-0">{st.label}</Badge>
					{#if fb.labels}
						{#each fb.labels as l (l)}<Badge variant="outline" class="text-[10px]">{l}</Badge>{/each}
					{/if}
				</div>
				<p class="whitespace-pre-wrap text-sm text-muted-foreground">{fb.content}</p>
				<p class="mt-2 text-xs text-muted-foreground">— {fb.author}{fb.authorRole ? `（${fb.authorRole}）` : ""}</p>
				{#if fb.replies?.length}
					<div class="mt-3 space-y-2 border-l-2 border-border pl-3">
						{#each fb.replies as rep (rep.content + rep.author)}
							<div class="flex items-start gap-1.5 text-xs">
								<MessageSquareReply class="mt-0.5 size-3.5 shrink-0 text-primary" />
								<span><span class="font-medium text-foreground">{rep.author}</span>：{rep.content}</span>
							</div>
						{/each}
					</div>
				{/if}
			</Card>
		{/each}
	</div>
</div>
