<script lang="ts">
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { BookMarked, FileText, ListTree, Pencil, MessageSquareWarning } from "@lucide/svelte";
	import Comments from "$lib/components/comments.svelte";
	import ViewTracker from "$lib/components/view-tracker.svelte";

	let { data }: {
		data: {
			doc: any;
			html: string;
			toc: { id: string; text: string; level: number }[];
			words: number;
			allDocs: any[];
			canEdit?: boolean;
			user?: { username: string; role: string } | null;
		}
	} = $props();

	// Group docs by folder for the left nav
	const groupedDocs = (() => {
		const map = new Map<string, any[]>();
		for (const d of data.allDocs) {
			const key = d.folder || "未分组";
			if (!map.has(key)) map.set(key, []);
			map.get(key)!.push(d);
		}
		return [...map.entries()];
	})();

	// 文档纠错（用户贡献）
	let showCorrect = $state(false);
	let correctionSection = $state("");
	let correctionSuggestion = $state("");
	let correctionNote = $state("");
	let correctionMsg = $state("");
	let correctionErr = $state("");

	async function submitCorrection() {
		correctionErr = ""; correctionMsg = "";
		if (!correctionSuggestion.trim()) { correctionErr = "请填写纠错建议"; return; }
		try {
			const res = await fetch("/api/doc-corrections", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ docSlug: data.doc.slug, section: correctionSection, suggestion: correctionSuggestion, note: correctionNote })
			});
			if (res.ok) {
				correctionSuggestion = ""; correctionSection = ""; correctionNote = "";
				showCorrect = false;
				correctionMsg = "已提交，等待审核后采纳";
				setTimeout(() => (correctionMsg = ""), 3000);
			} else {
				const d = await res.json();
				correctionErr = d.error || "提交失败";
			}
		} catch { correctionErr = "网络错误"; }
	}
</script>

<svelte:head>
	<title>{data.doc.title} | Stelarith</title>
	<meta name="description" content={data.doc.excerpt || data.doc.title} />
	<meta property="og:title" content={data.doc.title} />
	<meta property="og:description" content={data.doc.excerpt || data.doc.title} />
	<meta property="og:type" content="article" />
</svelte:head>

<ViewTracker target={"docs:" + data.doc.slug} />

<div class="mx-auto flex w-full max-w-[1400px] flex-col gap-8 px-4 py-10 md:flex-row md:px-8">
	<!-- Left: docs nav grouped by folder -->
	<nav class="shrink-0 md:w-52">
		<div class="mb-3 flex items-center justify-between">
			<a href="/docs" class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
				<BookMarked class="size-4" />
				文档库
			</a>
			{#if data.canEdit}
				<a href="/admin/docs/{data.doc.slug}" class="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary">
					<Pencil class="size-3" />
					编辑
				</a>
			{/if}
		</div>
		<div class="flex flex-col gap-0.5">
			{#each groupedDocs as [folder, list] (folder)}
				{#if folder !== "未分组"}<p class="px-3 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">{folder}</p>{/if}
				{#each list as d (d.slug)}
					<a
						href="/docs/{d.slug}"
						class="flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors {d.slug === data.doc.slug
							? 'bg-accent font-medium text-foreground'
							: 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}"
					>
						<FileText class="size-3.5 shrink-0" />
						<span class="truncate">{d.title}</span>
					</a>
				{/each}
			{/each}
		</div>
	</nav>

	<!-- Content -->
	<article class="min-w-0 flex-1">
		<header class="mb-6 flex flex-col gap-3">
			<div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
				{#if data.doc.category}<Badge variant="outline">{data.doc.category}</Badge>{/if}
				{#if data.doc.folder}<Badge variant="secondary">{data.doc.folder}</Badge>{/if}
				<span>{data.doc.date} · {data.words.toLocaleString()} 字</span>
			</div>
			<h1 class="font-heading text-3xl font-semibold tracking-tight">{data.doc.title}</h1>
		</header>

		<div class="prose prose-invert max-w-none">
			{@html data.html}
		</div>

		<Comments target={"docs:" + data.doc.slug} user={data.user} />

		<!-- 文档纠错（用户贡献） -->
		<section class="mt-8 rounded-xl border border-border/60 bg-card p-4">
			{#if data.user}
				{#if !showCorrect}
					<Button variant="outline" size="sm" onclick={() => (showCorrect = true)} class="gap-1.5">
						<MessageSquareWarning class="size-4" /> 发现错误？纠错
					</Button>
				{:else}
					<h3 class="mb-3 text-sm font-medium">提交纠错</h3>
					<input bind:value={correctionSection} placeholder="相关章节（可选）" maxlength="120" class="mb-2 h-9 w-full max-w-xs rounded-md border bg-background px-3 text-sm outline-none focus:border-primary/60" />
					<textarea bind:value={correctionSuggestion} rows={3} maxlength="2000" placeholder="正确的写法或表述…" class="mb-2 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60"></textarea>
					<input bind:value={correctionNote} placeholder="补充说明（可选）" maxlength="500" class="mb-2 h-9 w-full max-w-md rounded-md border bg-background px-3 text-sm outline-none focus:border-primary/60" />
					{#if correctionErr}<p class="mb-2 text-xs text-destructive">{correctionErr}</p>{/if}
					<div class="flex justify-end gap-2">
						<Button variant="ghost" size="sm" onclick={() => (showCorrect = false)}>取消</Button>
						<Button size="sm" onclick={submitCorrection}>提交</Button>
					</div>
				{/if}
			{:else}
				<a href="/admin/login" class="text-xs text-muted-foreground hover:text-primary">登录后可纠错文档</a>
			{/if}
			{#if correctionMsg}<p class="mt-2 text-xs text-primary">{correctionMsg}</p>{/if}
		</section>

		<footer class="mt-8 border-t border-border/40 pt-6">
			<a href="/docs" class="text-xs text-muted-foreground hover:text-primary">← 返回文档库</a>
		</footer>
	</article>

	<!-- TOC -->
	{#if data.toc.length > 0}
		<aside class="hidden w-52 shrink-0 lg:block">
			<div class="sticky top-6 rounded-lg border border-border/60 bg-card p-4">
				<p class="mb-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
					<ListTree class="size-3" />
					目录
				</p>
				<nav class="flex flex-col gap-1.5">
					{#each data.toc as item (item.id)}
						<a
							href="#{item.id}"
							class="text-xs transition-colors hover:text-primary {item.level === 2 ? 'font-medium text-foreground' : 'pl-3 text-muted-foreground'}"
						>{item.text}</a
						>
					{/each}
				</nav>
			</div>
		</aside>
	{/if}
</div>