<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import { MessageSquareWarning, Pencil } from "@lucide/svelte";
	import Comments from "$lib/components/comments.svelte";
	import ViewTracker from "$lib/components/view-tracker.svelte";
	import ReadingTracker from "$lib/components/reading-tracker.svelte";
	import RollingNumber from "$lib/components/rhine/rolling-number.svelte";
	import TypingText from "$lib/components/rhine/typing-text.svelte";

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

	// 按分组归集左栏索引
	const groupedDocs = (() => {
		const map = new Map<string, any[]>();
		for (const d of data.allDocs) {
			const key = d.folder || "未分组";
			if (!map.has(key)) map.set(key, []);
			map.get(key)!.push(d);
		}
		return [...map.entries()];
	})();

	// 档案编号（全册连续），与列表页同一套编号规则
	const indexOf = (() => {
		const m = new Map<string, number>();
		let i = 0;
		for (const [, list] of groupedDocs) for (const d of list) m.set(d.slug, ++i);
		return m;
	})();

	const currentIndex = $derived(indexOf.get(data.doc.slug) ?? 0);
	const totalDocs = $derived(data.allDocs.length);

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
<ReadingTracker target={"docs:" + data.doc.slug} title={data.doc.title} section="docs" />

<div class="rhine-docs min-h-screen bg-background text-foreground">
	<div class="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-4 py-8 md:flex-row md:px-8">
		<!-- ══ 左栏：档案索引（终端目录树） ══════════════════════════════ -->
		<nav class="shrink-0 md:w-56">
			<div class="mb-4 flex items-center justify-between border-b border-border/70 pb-2">
				<a href="/docs" class="flex items-center gap-1.5 transition-colors hover:text-primary">
					<span class="rhine-tick"></span>
					<span class="rhine-label">Archive Index</span>
				</a>
				{#if data.canEdit}
					<a
						href="/admin/docs/{data.doc.slug}"
						class="flex items-center gap-1 border border-border/60 px-1.5 py-0.5 text-[10px] tracking-wider text-muted-foreground uppercase transition-colors hover:border-primary/50 hover:text-primary"
					>
						<Pencil class="size-3" />
						编辑
					</a>
				{/if}
			</div>

			<div class="flex flex-col gap-4">
				{#each groupedDocs as [folder, list] (folder)}
					<div class="flex flex-col">
						{#if folder !== "未分组"}
							<p class="rhine-label rhine-label-sm mb-1.5">{folder}</p>
						{/if}
						<div class="flex flex-col">
							{#each list as d (d.slug)}
								<a
									href="/docs/{d.slug}"
									data-active={d.slug === data.doc.slug}
									class="rhine-row flex items-center gap-2 py-1.5 pr-2 pl-3 text-sm {d.slug === data.doc.slug
										? 'font-medium text-foreground'
										: 'text-muted-foreground hover:text-foreground'}"
								>
									<span class="rhine-num w-5 shrink-0 text-[10px] text-muted-foreground/60">
										<RollingNumber value={indexOf.get(d.slug) ?? 0} pad={2} />
									</span>
									<span class="truncate">{d.title}</span>
								</a>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		</nav>

		<!-- ══ 正文：档案阅读终端 ═══════════════════════════════════════ -->
		<article class="rhine-screen min-w-0 flex-1 border border-border/70">
			<!-- 档案抬头：编号 + 权限字段 + 打字标题 -->
			<header class="flex flex-col gap-4 px-5 py-5 md:px-7 md:py-6">
				<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
					<div class="flex items-baseline gap-2">
						<span class="rhine-label">File</span>
						<span class="rhine-num text-sm font-semibold">
							<RollingNumber value={currentIndex} pad={2} label="档案编号" />
						</span>
						<span class="rhine-num text-[10px] text-muted-foreground/60">/ {String(totalDocs).padStart(2, "0")}</span>
					</div>
					{#if data.doc.category}
						<span class="rhine-label rhine-label-sm border border-border/60 px-1.5 py-0.5">{data.doc.category}</span>
					{/if}
					{#if data.doc.folder}
						<span class="rhine-label rhine-label-sm border border-border/60 px-1.5 py-0.5">{data.doc.folder}</span>
					{/if}
					<span class="rhine-num ml-auto text-[10px] text-muted-foreground/70">{data.doc.date}</span>
				</div>

				<h1 class="text-2xl font-semibold tracking-tight md:text-3xl">
					<TypingText text={data.doc.title} duration={980} />
				</h1>

				<!-- 元信息字段表：细线分隔的键值对，像档案卡 -->
				<dl class="rhine-rule grid grid-cols-2 gap-x-6 gap-y-2 pt-3 md:grid-cols-4">
					<div class="flex flex-col gap-0.5">
						<dt class="rhine-label rhine-label-sm">Entries</dt>
						<dd class="rhine-num text-sm">{String(totalDocs).padStart(2, "0")}</dd>
					</div>
					<div class="flex flex-col gap-0.5">
						<dt class="rhine-label rhine-label-sm">Words</dt>
						<dd class="rhine-num text-sm">{data.words.toLocaleString()}</dd>
					</div>
					<div class="flex flex-col gap-0.5">
						<dt class="rhine-label rhine-label-sm">Sections</dt>
						<dd class="rhine-num text-sm">{String(data.toc.length).padStart(2, "0")}</dd>
					</div>
					<div class="flex flex-col gap-0.5">
						<dt class="rhine-label rhine-label-sm">Status</dt>
						<dd class="rhine-label text-primary">Authorized</dd>
					</div>
				</dl>
			</header>

			<!-- 正文 -->
			<div class="prose max-w-none border-t border-border/70 px-5 py-6 md:px-7">
				{@html data.html}
			</div>

			<!-- 纠错 -->
			<section class="border-t border-border/70 px-5 py-4 md:px-7">
				{#if data.user}
					{#if !showCorrect}
						<Button variant="outline" size="sm" onclick={() => (showCorrect = true)} class="gap-1.5">
							<MessageSquareWarning class="size-4" /> 发现错误？纠错
						</Button>
					{:else}
						<h3 class="rhine-label mb-3">Submit Correction</h3>
						<input bind:value={correctionSection} placeholder="相关章节（可选）" maxlength="120" class="mb-2 h-9 w-full max-w-xs border bg-background px-3 text-sm outline-none focus:border-primary/60" />
						<textarea bind:value={correctionSuggestion} rows={3} maxlength="2000" placeholder="正确的写法或表述…" class="mb-2 w-full resize-y border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60"></textarea>
						<input bind:value={correctionNote} placeholder="补充说明（可选）" maxlength="500" class="mb-2 h-9 w-full max-w-md border bg-background px-3 text-sm outline-none focus:border-primary/60" />
						{#if correctionErr}<p class="mb-2 text-xs text-destructive">{correctionErr}</p>{/if}
						<div class="flex justify-end gap-2">
							<Button variant="ghost" size="sm" onclick={() => (showCorrect = false)}>取消</Button>
							<Button size="sm" onclick={submitCorrection}>提交</Button>
						</div>
					{/if}
				{:else}
					<a href="/admin/login" class="rhine-label hover:text-primary">登录后可纠错教程</a>
				{/if}
				{#if correctionMsg}<p class="mt-2 text-xs text-primary">{correctionMsg}</p>{/if}
			</section>

			<!-- 评论 -->
			<div class="border-t border-border/70 px-5 py-4 md:px-7">
				<Comments target={"docs:" + data.doc.slug} user={data.user} />
			</div>

			<footer class="flex items-center justify-between border-t border-border/70 px-5 py-3 md:px-7">
				<a href="/docs" class="rhine-label hover:text-primary">← 返回索引</a>
				<span class="rhine-label rhine-label-sm">Stelarith OS</span>
			</footer>
		</article>

		<!-- ══ 右栏：目录（终端刻度） ═══════════════════════════════════ -->
		{#if data.toc.length > 0}
			<aside class="hidden w-52 shrink-0 lg:block">
				<div class="sticky top-6 border border-border/70 p-4">
					<p class="rhine-label mb-3">Contents</p>
					<nav class="flex flex-col gap-1">
						{#each data.toc as item (item.id)}
							<a
								href="#{item.id}"
								class="border-l-2 border-transparent py-1 pl-2 text-xs transition-colors hover:border-primary hover:text-primary {item.level === 2 ? 'font-medium text-foreground' : 'pl-4 text-muted-foreground'}"
							>{item.text}</a
							>
						{/each}
					</nav>
				</div>
			</aside>
		{/if}
	</div>
</div>
