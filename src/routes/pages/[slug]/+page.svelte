<script lang="ts">
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Pencil, ListTree, ArrowUp } from "@lucide/svelte";
	import Comments from "$lib/components/comments.svelte";
	import ViewTracker from "$lib/components/view-tracker.svelte";
	import ReadingTracker from "$lib/components/reading-tracker.svelte";
	import { LAYOUT_PRESETS } from "$lib/page-templates.js";
	import { onMount } from "svelte";

	let { data }: { data: { page: any; html: string; words: number; canEdit?: boolean; user?: { username: string; role: string } | null; toc?: { id: string; text: string; level: number }[] } } = $props();

	// 版心宽度：编辑器里选的 layout 决定这里的 max-width。
	// 与编辑器预览共用 LAYOUT_PRESETS 同一数据源，避免两边定义漂移。
	const maxWidth = $derived(
		LAYOUT_PRESETS.find((p) => p.value === data.page.layout)?.maxWidth ?? "820px"
	);
	const isFull = $derived(data.page.layout === "full");

	// 页面级主题色：优先用页面自定义 accent，否则继承站点 --primary。
	// 挂在包裹层上，作用域只覆盖本页子树，不影响站内其它部分。
	const accentStyle = $derived(
		data.page.accent ? `--primary: ${data.page.accent}; --ring: ${data.page.accent};` : ""
	);

	const toc = $derived((data.toc ?? []) as { id: string; text: string; level: number }[]);
	const showAside = $derived(!!data.page.aside && toc.length > 0);

	// 回到顶部：长文（尤其宽版心）滚到底后没有回顶入口很难受。
	let showTop = $state(false);
	onMount(() => {
		const onScroll = () => { showTop = window.scrollY > 600; };
		window.addEventListener("scroll", onScroll, { passive: true });
		onScroll();
		return () => window.removeEventListener("scroll", onScroll);
	});

	// 目录点击：平滑滚动（尊重系统"减少动态效果"偏好）
	function jump(id: string) {
		const el = document.getElementById(id);
		if (!el) return;
		const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
	}
</script>

<svelte:head>
	<title>{data.page.title} | Stelarith</title>
	<meta name="description" content={data.page.excerpt || data.page.title} />
	{#if data.page.noindex}
		<meta name="robots" content="noindex, follow" />
	{/if}
	<meta property="og:title" content={data.page.title} />
	<meta property="og:type" content="article" />
	{#if data.page.cover}
		<meta property="og:image" content={data.page.cover} />
	{/if}
</svelte:head>

<ViewTracker target={"pages:" + data.page.slug} />
<!-- 阅读进度：滚动时记录位置，下次进入可续读 -->
<ReadingTracker target={"pages:" + data.page.slug} title={data.page.title} section="pages" />

<!-- 页面级主题色：包在外层，让本页主色覆盖只作用于这棵子树 -->
<div style={accentStyle}>
	<!-- 页头横幅：仅在 hero=banner 且有封面时铺一条背景带 -->
	{#if data.page.hero === "banner" && data.page.cover}
		<div class="relative h-40 w-full overflow-hidden bg-muted sm:h-56 md:h-64">
			<img src={data.page.cover} alt="" class="size-full object-cover" />
			<div class="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent"></div>
		</div>
	{/if}

	<div
		class="mx-auto w-full py-10 {isFull ? 'max-w-none px-3 md:px-6' : 'px-4 md:px-8'}"
		style={isFull ? "" : `max-width: ${maxWidth}`}
	>
		{#if data.canEdit}
			<div class="mb-3 flex justify-end">
				<a href="/admin/pages/{data.page.slug}" class="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary">
					<Pencil class="size-3" /> 编辑
				</a>
			</div>
		{/if}

		<!-- 正文与目录侧栏并排：aside 开关控制 -->
		<div class={showAside ? "lg:grid lg:grid-cols-[minmax(0,1fr)_13rem] lg:gap-10" : ""}>
			<div class="min-w-0">
				{#if data.page.hero !== "none" && !data.page.hideTitle}
					<header class="mb-6 flex flex-col gap-3">
						<div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
							{#if data.page.category}<Badge variant="outline">{data.page.category}</Badge>{/if}
							<span>{data.page.date} · {data.words.toLocaleString()} 字</span>
						</div>
						<h1 class="font-heading text-3xl font-semibold tracking-tight md:text-4xl">{data.page.title}</h1>
						{#if data.page.excerpt}
							<p class="text-sm leading-relaxed text-muted-foreground">{data.page.excerpt}</p>
						{/if}
					</header>
				{/if}

				{#if data.page.toc && toc.length > 0}
					<!-- 正文内目录：窄屏替代侧栏（侧栏在 lg 以下隐藏） -->
					<nav class="mb-8 rounded-xl border border-border/60 bg-muted/30 p-4 lg:hidden" aria-label="本页目录">
						<p class="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
							<ListTree class="size-3.5" /> 本页目录
						</p>
						<ul class="space-y-1.5">
							{#each toc as item (item.id)}
								<li class={item.level === 3 ? "pl-3" : ""}>
									<button
										class="text-left text-sm text-muted-foreground transition-colors hover:text-primary"
										onclick={() => jump(item.id)}
									>{item.text}</button>
								</li>
							{/each}
						</ul>
					</nav>
				{/if}

				<!-- 双主题下不能再写 prose-invert（那会让亮色模式的正文变成浅字浅底） -->
				<div class="prose max-w-none">
					{@html data.html}
				</div>

				<Comments target={"pages:" + data.page.slug} user={data.user} />

				<footer class="mt-8 border-t border-border/40 pt-6">
					<a href="/pages" class="text-xs text-muted-foreground hover:text-primary">← 返回页面列表</a>
				</footer>
			</div>

			{#if showAside}
				<!-- 目录侧栏：sticky 跟随阅读位置，长文导航的效率来源 -->
				<aside class="hidden lg:block">
					<nav class="sticky top-20" aria-label="本页目录">
						<p class="mb-3 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
							<ListTree class="size-3.5" /> 本页目录
						</p>
						<ul class="space-y-2 border-l border-border/60 pl-3">
							{#each toc as item (item.id)}
								<li class={item.level === 3 ? "pl-2" : ""}>
									<button
										class="text-left text-[13px] leading-snug text-muted-foreground transition-colors hover:text-primary"
										onclick={() => jump(item.id)}
									>{item.text}</button>
								</li>
							{/each}
						</ul>
					</nav>
				</aside>
			{/if}
		</div>
	</div>

	<!-- 回到顶部：滚动超过一屏后出现 -->
	{#if showTop}
		<button
			class="fixed bottom-6 right-6 z-40 flex size-10 items-center justify-center rounded-full border border-border/60 bg-card text-muted-foreground shadow-lg transition-all duration-200 hover:border-primary/50 hover:text-primary motion-reduce:transition-none"
			onclick={() => jump("main-content")}
			title="回到顶部"
			aria-label="回到顶部"
		>
			<ArrowUp class="size-4" />
		</button>
	{/if}
</div>
