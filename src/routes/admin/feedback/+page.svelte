<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Textarea } from "$lib/components/ui/textarea/index.js";
	import * as Select from "$lib/components/ui/select/index.js";
	import { MessageSquare, Trash2, Loader2, Send } from "@lucide/svelte";
	import { toast } from "svelte-sonner";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	const STATUS: Record<string, { label: string; cls: string }> = {
		open: { label: "待处理", cls: "border-border bg-transparent text-muted-foreground" },
		planned: { label: "已规划", cls: "border-sky-500/50 text-sky-300" },
		in_progress: { label: "处理中", cls: "border-amber-500/50 text-amber-300" },
		closed: { label: "已关闭", cls: "border-emerald-500/50 text-emerald-300" }
	};
	const STATUSES = [
		{ value: "open", label: "待处理" },
		{ value: "planned", label: "已规划" },
		{ value: "in_progress", label: "处理中" },
		{ value: "closed", label: "已关闭" }
	];

	let replyFor = $state<string | null>(null);
	let replyText = $state("");
	let saving = $state(false);

	async function setStatus(id: string, status: string) {
		try {
			const res = await fetch("/api/feedback", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
			if (res.ok) await invalidateAll();
			else toast.error("更新失败");
		} catch { toast.error("网络错误"); }
	}
	async function sendReply(id: string) {
		if (!replyText.trim()) return;
		saving = true;
		try {
			const res = await fetch("/api/feedback", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, content: replyText }) });
			if (res.ok) { toast.success("已回复"); replyText = ""; replyFor = null; await invalidateAll(); }
			else toast.error("回复失败");
		} catch { toast.error("网络错误"); }
		saving = false;
	}
	async function remove(id: string) {
		if (!confirm("删除这条反馈？")) return;
		try {
			const res = await fetch("/api/feedback", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
			if (res.ok) await invalidateAll();
			else toast.error("删除失败");
		} catch { toast.error("网络错误"); }
	}
</script>

<svelte:head><title>反馈管理 | Stelarith</title><meta name="robots" content="noindex" /></svelte:head>

<div class="mb-6 flex items-center justify-between">
	<div>
		<h1 class="text-2xl font-heading font-semibold">反馈管理</h1>
		<p class="text-sm text-muted-foreground">处理用户反馈、变更状态、以官方身份回复</p>
	</div>
	<Badge variant="outline">共 {data.feedbacks.length} 条</Badge>
</div>

{#if data.feedbacks.length === 0}
	<div class="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">暂无反馈</div>
{:else}
	<div class="space-y-3">
		{#each data.feedbacks as f (f.id)}
			<div class="rounded-xl border border-border/60 bg-card p-4">
				<div class="flex flex-wrap items-center gap-2">
					<MessageSquare class="size-4 shrink-0 text-primary" />
					<h3 class="font-medium">{f.title}</h3>
					<Badge variant="outline" class="text-[10px] {STATUS[f.status]?.cls}">{STATUS[f.status]?.label}</Badge>
					<span class="text-xs text-muted-foreground">{f.author} · {f.createdAt?.slice(0, 10)}</span>
					<div class="ml-auto flex items-center gap-1">
						<Select.Root type="single" value={f.status}>
							<Select.Trigger class="w-28 text-xs">{STATUS[f.status]?.label}</Select.Trigger>
							<Select.Content>
								{#each STATUSES as s (s.value)}<Select.Item value={s.value} label={s.label} onclick={() => setStatus(f.id, s.value)} />{/each}
							</Select.Content>
						</Select.Root>
						<Button size="sm" variant="ghost" class="text-destructive hover:text-destructive" onclick={() => remove(f.id)}><Trash2 class="size-3.5" /></Button>
					</div>
				</div>
				<p class="mt-2 whitespace-pre-wrap text-sm text-foreground/90">{f.content}</p>
				{#if (f.replies || []).length > 0}
					<div class="mt-2 space-y-1.5 border-l-2 border-border/60 pl-3">
						{#each f.replies as r (r.id)}
							<p class="text-sm"><span class="font-medium text-primary">{r.author}</span><span class="text-xs text-muted-foreground"> · {r.createdAt?.slice(0, 10)}</span><br />{r.content}</p>
						{/each}
					</div>
				{/if}
				{#if replyFor === f.id}
					<div class="mt-3 flex flex-col gap-2">
						<Textarea bind:value={replyText} rows={2} placeholder="以官方身份回复…" />
						<div class="flex justify-end gap-2">
							<Button variant="ghost" size="sm" onclick={() => (replyFor = null)}>取消</Button>
							<Button size="sm" onclick={() => sendReply(f.id)} disabled={saving || !replyText.trim()}><Send class="size-3.5 mr-1" /> 回复</Button>
						</div>
					</div>
				{:else}
					<button class="mt-2 text-xs text-primary hover:underline" onclick={() => (replyFor = f.id)}>官方回复</button>
				{/if}
			</div>
		{/each}
	</div>
{/if}
