<script lang="ts">
	import { onMount } from "svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { History, RotateCcw, FileText, BookMarked, Rocket, Eye } from "@lucide/svelte";
	import Container from "$lib/components/container.svelte";
	import PageHeader from "$lib/components/page-header.svelte";

	interface Item { section: string; slug: string; title: string; versions: number; latestAt: string; }
	let items = $state<Item[]>([]);
	let loading = $state(true);

	// 详情抽屉
	let open = $state(false);
	let cur = $state<{ section: string; slug: string; title: string } | null>(null);
	let versions = $state<{ id: string; version: number; savedAt: string; editor: string; size: number }[]>([]);
	let previewRaw = $state("");
	let previewId = $state("");
	let busy = $state(false);
	let msg = $state("");

	const sectionLabel: Record<string, string> = { posts: "博客", projects: "项目", docs: "文档" };

	async function load() {
		loading = true;
		try {
			const res = await fetch("/api/archive");
			if (res.ok) { const d = await res.json(); items = d.items; }
		} catch { /* ignore */ }
		loading = false;
	}

	async function openItem(it: Item) {
		cur = it; open = true; previewRaw = ""; previewId = ""; msg = "";
		const res = await fetch(`/api/archive?section=${it.section}&slug=${encodeURIComponent(it.slug)}`);
		if (res.ok) { const d = await res.json(); versions = d.versions; }
		else versions = [];
	}

	async function preview(vid: string) {
		if (!cur) return;
		busy = true;
		const res = await fetch(`/api/archive?section=${cur.section}&slug=${encodeURIComponent(cur.slug)}&version=${vid}`);
		if (res.ok) { const d = await res.json(); previewRaw = d.raw; previewId = vid; }
		busy = false;
	}

	async function restore(vid: string) {
		if (!cur) return;
		if (!confirm(`确定回滚到该版本？当前内容会作为新快照保留。`)) return;
		busy = true; msg = "";
		const res = await fetch("/api/archive", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ section: cur.section, slug: cur.slug, version: vid })
		});
		busy = false;
		if (res.ok) { msg = "已回滚到该版本"; await openItem(cur); }
		else { msg = "回滚失败：需要管理员/审核权限"; }
	}

	onMount(load);
</script>

<svelte:head>
	<title>归档 | Stelarith</title>
</svelte:head>

<Container class="gap-10">
	<PageHeader title="归档" description="历史版本与内容快照，记录每一次修改，可随时查看与回滚。" />

	{#if loading}
		<p class="text-muted-foreground">加载中…</p>
	{:else if items.length === 0}
		<div class="flex flex-col items-center gap-2 rounded-xl border border-dashed p-12 text-center text-muted-foreground">
			<History class="size-8" />
			<p class="text-sm">暂无归档记录。保存内容后会自动生成版本快照。</p>
		</div>
	{:else}
		<div class="space-y-3">
			{#each items as it (it.section + it.slug)}
				<button onclick={() => openItem(it)} class="flex w-full items-center gap-3 rounded-xl border border-border/60 bg-card p-4 text-left transition-colors hover:border-primary/40">
					<div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
						{#if it.section === "posts"}<FileText class="size-5" />
						{:else if it.section === "projects"}<Rocket class="size-5" />
						{:else}<BookMarked class="size-5" />{/if}
					</div>
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm font-medium">{it.title}</p>
						<p class="text-xs text-muted-foreground">{sectionLabel[it.section]} · {it.versions} 个版本 · 最近 {new Date(it.latestAt).toLocaleString()}</p>
					</div>
					<Badge variant="outline">{it.versions} 版</Badge>
				</button>
			{/each}
		</div>
	{/if}
</Container>

{#if open && cur}
	<div class="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" onclick={() => (open = false)} role="presentation">
		<div class="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border bg-card" onclick={(e) => e.stopPropagation()} role="presentation">
			<div class="flex items-center justify-between border-b p-4">
				<div>
					<p class="font-heading text-base font-medium">{cur.title}</p>
					<p class="text-xs text-muted-foreground">{sectionLabel[cur.section]} · 版本历史</p>
				</div>
				<button onclick={() => (open = false)} class="rounded-md p-1 text-muted-foreground hover:bg-muted">✕</button>
			</div>
			<!-- header close -->
			<div class="flex min-h-0 flex-1">
				<div class="w-44 shrink-0 overflow-y-auto border-r p-2">
					{#each versions as v (v.id)}
						<button onclick={() => preview(v.id)} class="flex w-full flex-col gap-0.5 rounded-md p-2 text-left text-xs hover:bg-muted {previewId === v.id ? 'bg-muted' : ''}">
							<span class="font-medium">v{v.version}</span>
							<span class="text-muted-foreground">{new Date(v.savedAt).toLocaleString()}</span>
							<span class="text-muted-foreground">{v.editor} · {(v.size / 1024).toFixed(1)}KB</span>
						</button>
					{/each}
				</div>
				<div class="min-w-0 flex-1 overflow-auto p-3">
					{#if busy}
						<p class="text-xs text-muted-foreground">加载中…</p>
					{:else if previewRaw}
						<pre class="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/90">{previewRaw}</pre>
					{:else}
						<p class="text-xs text-muted-foreground">选择左侧版本查看快照内容</p>
					{/if}
				</div>
			</div>
			<div class="flex items-center justify-between gap-2 border-t p-3">
				{#if msg}
					<span class="text-xs text-primary">{msg}</span>
				{/if}
				<div class="flex gap-2">
					<Button variant="outline" size="sm" onclick={() => preview(previewId)} disabled={!previewId || busy}><Eye class="size-3.5" /> 预览</Button>
					<Button size="sm" onclick={() => restore(previewId)} disabled={!previewId || busy}><RotateCcw class="size-3.5" /> 回滚此版本</Button>
				</div>
			</div>
		</div>
	</div>
{/if}
