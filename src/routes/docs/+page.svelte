<script lang="ts">
	import { BookMarked } from "@lucide/svelte";
	import Container from "$lib/components/container.svelte";
	import RollingNumber from "$lib/components/rhine/rolling-number.svelte";
	import TypingText from "$lib/components/rhine/typing-text.svelte";

	let { data }: { data: { docs: any[]; canEdit?: boolean } } = $props();

	// 按分组归集（保持原有的 folder → category 兜底逻辑）
	const groups = (() => {
		const map = new Map<string, any[]>();
		for (const doc of data.docs) {
			const key = doc.folder || doc.category || "未分类";
			if (!map.has(key)) map.set(key, []);
			map.get(key)!.push(doc);
		}
		return [...map.entries()];
	})();

	// 全局序号：档案编号在整册里连续，而不是每组分头从 01 开始
	const indexOf = (() => {
		const m = new Map<string, number>();
		let i = 0;
		for (const [, list] of groups) for (const d of list) m.set(d.slug, ++i);
		return m;
	})();

	const total = $derived(data.docs.length);
	const groupCount = $derived(groups.length);
</script>

<svelte:head>
	<title>教程 | Stelarith</title>
</svelte:head>

<!-- 作用域根：.rhine-docs 让莱茵令牌只在这一页生效 -->
<div class="rhine-docs min-h-screen bg-background text-foreground">
	<Container>
		<!-- ══ 终端抬头：品牌行 + 打字标题 + 统计数字滚动 ══════════════════ -->
		<header class="rhine-screen relative flex flex-col gap-5 border border-border/70 px-5 py-6 md:px-8 md:py-8">
			<!-- 顶行：索引标签 + 署名 -->
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div class="flex items-center gap-2.5">
					<span class="rhine-tick"></span>
					<span class="rhine-label">Archive Index</span>
				</div>
				<span class="rhine-label rhine-label-sm">Stelarith · Documentation</span>
			</div>

			<!-- 主标题：终端逐字打字 -->
			<div class="flex flex-col gap-2">
				<h1 class="text-3xl font-semibold tracking-tight md:text-4xl">
					<TypingText text="教程库" duration={720} />
				</h1>
				<p class="max-w-2xl text-sm text-muted-foreground">
					AI 与大模型入门教程，以及 DeepSeek Harness 的使用指南。
				</p>
			</div>

			<!-- 底部统计：数字滚动（档案总数 / 分组数） -->
			<div class="rhine-rule flex flex-wrap items-center gap-x-8 gap-y-3 pt-4">
				<div class="flex items-baseline gap-2">
					<span class="rhine-num text-2xl font-semibold tracking-tight">
						<RollingNumber value={total} pad={2} label="教程总数" />
					</span>
					<span class="rhine-label">Entries</span>
				</div>
				<div class="flex items-baseline gap-2">
					<span class="rhine-num text-2xl font-semibold tracking-tight">
						<RollingNumber value={groupCount} pad={2} label="分组数" />
					</span>
					<span class="rhine-label">Sections</span>
				</div>
				{#if data.canEdit}
					<a href="/admin/docs/new" class="rhine-label ml-auto hover:text-primary">+ New Entry</a>
				{/if}
			</div>
		</header>

		{#if total === 0}
			<div class="flex flex-col items-start gap-3 border border-dashed border-border/70 p-12">
				<BookMarked class="size-6 text-muted-foreground" />
				<p class="text-sm text-muted-foreground">还没有教程，去后台创建第一篇吧。</p>
				{#if data.canEdit}
					<a href="/admin/docs/new" class="rhine-label hover:text-primary">Create Entry →</a>
				{/if}
			</div>
		{:else}
			<div class="flex flex-col gap-10">
				{#each groups as [category, docs], gi (category)}
					<section class="flex flex-col">
						<!-- 分组头：编号 + 名称 + 计数，细线下压 -->
						<div class="flex items-baseline gap-3 border-b border-border/70 pb-2">
							<span class="rhine-num text-xs text-muted-foreground">
								<RollingNumber value={gi + 1} pad={2} label="分组序号" />
							</span>
							<h2 class="text-lg font-semibold tracking-tight">{category}</h2>
							<span class="rhine-label ml-auto">
								{docs.length} {docs.length === 1 ? "item" : "items"}
							</span>
						</div>

						<!-- 档案行：细线分隔、悬停浮出信号条 -->
						<div class="flex flex-col">
							{#each docs as doc, di (doc.slug)}
								<a
									href="/docs/{doc.slug}"
									data-active={false}
									class="rhine-row rhine-in group flex items-start gap-3 border-b border-border/50 px-3 py-3.5 md:gap-4 md:px-4"
									style="animation-delay: {(gi * 60 + di * 40) % 480}ms"
								>
									<!-- 档案编号：全册连续 -->
									<span class="rhine-num mt-0.5 w-9 shrink-0 text-xs text-muted-foreground/80">
										<RollingNumber value={indexOf.get(doc.slug) ?? 0} pad={2} />
									</span>

									<div class="flex min-w-0 flex-1 flex-col gap-1">
										<div class="flex flex-wrap items-center gap-2">
											<h3 class="font-medium transition-colors group-hover:text-primary">{doc.title}</h3>
										</div>
										{#if doc.excerpt}
											<p class="line-clamp-1 text-xs text-muted-foreground">{doc.excerpt}</p>
										{/if}
									</div>

									<!-- 右侧元信息：分类标签 + 日期 -->
									<div class="flex shrink-0 flex-col items-end gap-1">
										{#if doc.category}
											<span class="rhine-label rhine-label-sm border border-border/60 px-1.5 py-0.5">{doc.category}</span>
										{/if}
										<span class="rhine-num text-[10px] text-muted-foreground/70">{doc.date}</span>
									</div>
								</a>
							{/each}
						</div>
					</section>
				{/each}
			</div>
		{/if}

		<!-- 页脚署名：呼应莱茵界面右下角 -->
		<footer class="flex items-center justify-between border-t border-border/50 pt-4">
			<span class="rhine-label rhine-label-sm">End of Index</span>
			<span class="rhine-label rhine-label-sm">Stelarith OS</span>
		</footer>
	</Container>
</div>
