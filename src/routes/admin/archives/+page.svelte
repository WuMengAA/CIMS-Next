<script lang="ts">
	/**
	 * 归档管理 —— 后台内容治理。
	 *
	 * 两个功能区：
	 * 1. 已归档条目：status=archived 的内容（前台已隐藏），可一键取消归档恢复发布。
	 * 2. 版本快照：每次保存自动留档的历史版本，可查看并回滚。
	 *
	 * 归档入口同时出现在各编辑器的快捷图标（保存旁的一键归档）。
	 */
	import { Button } from "$lib/components/ui/button/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Archive, RotateCcw, Inbox, ChevronDown, History } from "@lucide/svelte";
	import { toast } from "svelte-sonner";
	import { onMount } from "svelte";

	const SECTION_LABEL: Record<string, string> = { posts: "博客", projects: "项目", docs: "教程", pages: "页面" };

	interface ArchivedItem { section: string; slug: string; title: string; date: string; updated?: string; }
	interface SnapshotItem { section: string; slug: string; title: string; versions: number; latestAt: string; }

	let archived = $state<ArchivedItem[]>([]);
	let archivedLoading = $state(true);
	let snapshots = $state<SnapshotItem[]>([]);
	let snapshotsLoading = $state(true);
	let busy = $state(false);

	// 展开查看某条目的版本列表
	let openSlug = $state("");
	let versions = $state<{ id: string; version: number; savedAt: string; editor: string; size: number }[]>([]);
	let versionsLoading = $state(false);

	async function loadArchived() {
		archivedLoading = true;
		try {
			const res = await fetch("/api/archive?archived=1");
			if (res.ok) archived = (await res.json()).items || [];
		} catch (e) { console.error(e); }
		archivedLoading = false;
	}
	async function loadSnapshots() {
		snapshotsLoading = true;
		try {
			const res = await fetch("/api/archive");
			if (res.ok) snapshots = (await res.json()).items || [];
		} catch (e) { console.error(e); }
		snapshotsLoading = false;
	}

	async function toggleArchive(item: ArchivedItem) {
		if (!confirm(`确定恢复「${item.title}」为已发布？`)) return;
		busy = true;
		try {
			const res = await fetch("/api/archive", {
				method: "POST", headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "unarchive", section: item.section, slug: item.slug })
			});
			if (res.ok) {
				toast.success("已恢复发布");
				loadArchived(); loadSnapshots();
			} else {
				const r = await res.json();
				toast.error(r.error || "操作失败");
			}
		} catch (e) { console.error(e); toast.error("操作失败"); }
		busy = false;
	}

	async function toggleVersions(item: SnapshotItem) {
		if (openSlug === item.slug + item.section) { openSlug = ""; return; }
		openSlug = item.slug + item.section;
		versions = [];
		versionsLoading = true;
		try {
			const res = await fetch(`/api/archive?section=${item.section}&slug=${encodeURIComponent(item.slug)}`);
			if (res.ok) versions = (await res.json()).versions || [];
		} catch (e) { console.error(e); }
		versionsLoading = false;
	}

	async function restore(item: SnapshotItem, versionId: string) {
		if (!confirm(`将「${item.title}」回滚到该版本？当前内容会被覆盖（仍可再回滚）。`)) return;
		busy = true;
		try {
			const res = await fetch("/api/archive", {
				method: "POST", headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ section: item.section, slug: item.slug, version: versionId })
			});
			if (res.ok) toast.success("已回滚");
			else { const r = await res.json(); toast.error(r.error || "回滚失败"); }
		} catch (e) { console.error(e); toast.error("回滚失败"); }
		busy = false;
	}

	onMount(() => {
		loadArchived();
		loadSnapshots();
	});
</script>

<svelte:head>
	<title>归档管理 | Stelarith CMS</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="flex flex-col gap-6 p-4 md:p-6">
	<header class="flex flex-col gap-1">
		<div class="flex items-center gap-2">
			<Archive class="size-5 text-primary" />
			<h1 class="font-heading text-xl font-semibold">归档管理</h1>
		</div>
		<p class="text-sm text-muted-foreground">已归档内容已从前台隐藏；历史版本快照可随时查看与回滚。</p>
	</header>

	<!-- ═══ 已归档条目 ═══ -->
	<section class="rounded-xl border border-border/60 bg-card">
		<div class="flex items-center gap-2 border-b border-border/60 px-4 py-3">
			<Inbox class="size-4 text-muted-foreground" />
			<h2 class="font-heading text-sm font-semibold">已归档条目</h2>
			<Badge variant="secondary" class="ml-auto">{archived.length}</Badge>
		</div>
		<div class="p-4">
			{#if archivedLoading}
				<p class="py-6 text-center text-sm text-muted-foreground">加载中…</p>
			{:else if archived.length === 0}
				<p class="py-6 text-center text-sm text-muted-foreground">暂无已归档条目</p>
			{:else}
				<ul class="flex flex-col divide-y divide-border/40">
					{#each archived as item (item.section + item.slug)}
						<li class="flex items-center gap-3 py-2.5">
							<Badge variant="outline" class="shrink-0 font-mono text-[10px]">{SECTION_LABEL[item.section] || item.section}</Badge>
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-medium">{item.title}</p>
								<p class="truncate text-xs text-muted-foreground">/{item.slug} · {item.updated || item.date}</p>
							</div>
							<Button variant="outline" size="sm" onclick={() => toggleArchive(item)} disabled={busy}>
								<RotateCcw class="mr-1.5 size-3.5" />恢复发布
							</Button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</section>

	<!-- ═══ 版本快照 ═══ -->
	<section class="rounded-xl border border-border/60 bg-card">
		<div class="flex items-center gap-2 border-b border-border/60 px-4 py-3">
			<History class="size-4 text-muted-foreground" />
			<h2 class="font-heading text-sm font-semibold">版本快照</h2>
			<Badge variant="secondary" class="ml-auto">{snapshots.length}</Badge>
		</div>
		<div class="p-4">
			{#if snapshotsLoading}
				<p class="py-6 text-center text-sm text-muted-foreground">加载中…</p>
			{:else if snapshots.length === 0}
				<p class="py-6 text-center text-sm text-muted-foreground">暂无版本快照（每次保存内容会自动留档）</p>
			{:else}
				<ul class="flex flex-col divide-y divide-border/40">
					{#each snapshots as item (item.section + item.slug)}
						<li class="py-1.5">
							<button class="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-accent/60" onclick={() => toggleVersions(item)}>
								<ChevronDown class="size-4 shrink-0 text-muted-foreground transition-transform {openSlug === item.slug + item.section ? 'rotate-180' : ''}" />
								<Badge variant="outline" class="shrink-0 font-mono text-[10px]">{SECTION_LABEL[item.section] || item.section}</Badge>
								<span class="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</span>
								<span class="shrink-0 text-xs text-muted-foreground">{item.versions} 个版本 · {item.latestAt.slice(0, 16).replace("T", " ")}</span>
							</button>
							{#if openSlug === item.slug + item.section}
								<div class="px-8 pb-2">
									{#if versionsLoading}
										<p class="py-3 text-xs text-muted-foreground">加载中…</p>
									{:else if versions.length === 0}
										<p class="py-3 text-xs text-muted-foreground">该条目暂无版本记录</p>
									{:else}
										<ul class="flex flex-col divide-y divide-border/30">
											{#each versions as v (v.id)}
												<li class="flex items-center gap-3 py-2 text-sm">
													<span class="w-10 shrink-0 font-mono text-xs text-muted-foreground">v{v.version}</span>
													<span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">
														{v.savedAt.slice(0, 16).replace("T", " ")} · {v.editor} · {Math.max(1, Math.round(v.size / 1024))}KB
													</span>
													<Button variant="ghost" size="sm" class="h-7 text-xs" onclick={() => restore(item, v.id)} disabled={busy}>回滚</Button>
												</li>
											{/each}
										</ul>
									{/if}
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</section>
</div>
