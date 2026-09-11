<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Textarea } from "$lib/components/ui/textarea/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import * as Select from "$lib/components/ui/select/index.js";
	import { Megaphone, Plus, Trash2, Pencil, Pin, Loader2 } from "@lucide/svelte";
	import { toast } from "svelte-sonner";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	let showForm = $state(false);
	let editingId = $state<string | null>(null);
	let title = $state("");
	let content = $state("");
	let level = $state("info");
	let status = $state("published");
	let pinned = $state(false);
	let saving = $state(false);

	const LEVELS = [
		{ value: "info", label: "提示 (info)" },
		{ value: "success", label: "成功 (success)" },
		{ value: "warning", label: "警告 (warning)" },
		{ value: "danger", label: "危险 (danger)" }
	];
	const STATUSES = [
		{ value: "published", label: "已发布" },
		{ value: "draft", label: "草稿" },
		{ value: "archived", label: "归档" }
	];

	function reset() {
		editingId = null; title = ""; content = ""; level = "info"; status = "published"; pinned = false; showForm = false;
	}
	function edit(a: any) {
		editingId = a.id; title = a.title; content = a.content || ""; level = a.level || "info"; status = a.status || "published"; pinned = !!a.pinned; showForm = true;
	}

	async function save() {
		if (!title.trim()) { toast.error("标题不能为空"); return; }
		saving = true;
		const payload = { title, content, level, status, pinned };
		try {
			const res = editingId
				? await fetch("/api/announcements", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editingId, ...payload }) })
				: await fetch("/api/announcements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
			if (res.ok) { toast.success(editingId ? "已更新" : "已发布"); reset(); await invalidateAll(); }
			else { const d = await res.json().catch(() => ({})); toast.error(d.error || "保存失败"); }
		} catch { toast.error("网络错误"); }
		saving = false;
	}
	async function remove(id: string) {
		if (!confirm("删除这条公告？")) return;
		try {
			const res = await fetch("/api/announcements", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
			if (res.ok) await invalidateAll();
			else toast.error("删除失败");
		} catch { toast.error("网络错误"); }
	}
</script>

<svelte:head><title>公告管理 | Stelarith</title><meta name="robots" content="noindex" /></svelte:head>

<div class="mb-6 flex items-center justify-between">
	<div>
		<h1 class="text-2xl font-heading font-semibold">公告管理</h1>
		<p class="text-sm text-muted-foreground">发布站点公告，自动显示在全局横幅与公告页</p>
	</div>
	<Button onclick={() => (showForm = !showForm)}><Plus class="size-4 mr-1" /> 新建公告</Button>
</div>

{#if showForm}
	<div class="mb-6 rounded-xl border border-border/60 bg-card p-5">
		<div class="grid gap-3">
			<div class="grid gap-1.5"><label class="text-sm font-medium">标题</label><Input bind:value={title} placeholder="公告标题" /></div>
			<div class="grid gap-1.5"><label class="text-sm font-medium">内容</label><Textarea bind:value={content} rows={3} placeholder="公告正文（支持纯文本，可留空）" /></div>
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
				<div class="grid gap-1.5">
					<label class="text-sm font-medium">级别</label>
					<Select.Root type="single" bind:value={level}>
						<Select.Trigger class="w-full">{LEVELS.find(l => l.value === level)?.label ?? level}</Select.Trigger>
						<Select.Content>
							{#each LEVELS as l (l.value)}<Select.Item value={l.value} label={l.label} />{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div class="grid gap-1.5">
					<label class="text-sm font-medium">状态</label>
					<Select.Root type="single" bind:value={status}>
						<Select.Trigger class="w-full">{STATUSES.find(s => s.value === status)?.label ?? status}</Select.Trigger>
						<Select.Content>
							{#each STATUSES as s (s.value)}<Select.Item value={s.value} label={s.label} />{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<label class="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" bind:checked={pinned} class="size-4" /> 置顶</label>
			</div>
			<div class="flex justify-end gap-2">
				<Button variant="ghost" onclick={reset}>取消</Button>
				<Button onclick={save} disabled={saving || !title.trim()}>{saving ? "保存中…" : editingId ? "保存修改" : "发布"}</Button>
			</div>
		</div>
	</div>
{/if}

{#if data.announcements.length === 0}
	<div class="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">暂无公告</div>
{:else}
	<div class="space-y-3">
		{#each data.announcements as a (a.id)}
			<div class="flex items-start gap-3 rounded-xl border border-border/60 bg-card p-4">
				<Megaphone class="mt-0.5 size-4 shrink-0 text-primary" />
				<div class="min-w-0 flex-1">
					<div class="flex flex-wrap items-center gap-2">
						<h3 class="font-medium">{a.title}</h3>
						{#if a.pinned}<Badge variant="secondary" class="gap-1 text-[10px]"><Pin class="size-3" />置顶</Badge>{/if}
						<Badge variant="outline" class="text-[10px]">{a.level}</Badge>
						<Badge variant="outline" class="text-[10px]">{a.status}</Badge>
						<span class="text-xs text-muted-foreground">{a.createdAt?.slice(0, 10)}</span>
					</div>
					{#if a.content}<p class="mt-1 text-sm text-muted-foreground">{a.content}</p>{/if}
				</div>
				<div class="flex shrink-0 items-center gap-1">
					<Button size="sm" variant="outline" onclick={() => edit(a)}><Pencil class="size-3.5" /></Button>
					<Button size="sm" variant="ghost" class="text-destructive hover:text-destructive" onclick={() => remove(a.id)}><Trash2 class="size-3.5" /></Button>
				</div>
			</div>
		{/each}
	</div>
{/if}
