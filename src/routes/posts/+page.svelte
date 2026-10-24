<script lang="ts">
	// 博客列表 · 终末地 reading 范式（2026-10-21）
	// 页头 ex-sheet-head + 搜索 ex-search + 分类 ex-chip + 文章 ex-records 记录行。
	// 保留原搜索/分类筛选/置顶逻辑与数据绑定，仅视觉终末地化。
	// 2026-10-24：加右侧 sticky 侧栏（分类/标签/最近），与详情页 body-grid 同构；
	//            侧栏分类点击与顶部 chips 共用 activeCategory，天然联动。
	import "../endfield-kit.css";
	import Container from "$lib/components/container.svelte";
	import Seo from "$lib/components/Seo.svelte";

	let { data }: { data: { posts: any[]; categories: string[] } } = $props();

	let keyword = $state("");
	let activeCategory = $state("全部");

	const filtered = $derived(
		data.posts.filter((p: any) => {
			const matchCategory =
				activeCategory === "全部" ||
				p.category === activeCategory ||
				(p.tags || []).includes(activeCategory);
			const matchKeyword =
				keyword.trim() === "" ||
				p.title.toLowerCase().includes(keyword.trim().toLowerCase()) ||
				(p.excerpt || "").toLowerCase().includes(keyword.trim().toLowerCase()) ||
				(p.tags || []).some((t: string) => t.toLowerCase().includes(keyword.trim().toLowerCase()));
			return matchCategory && matchKeyword;
		})
	);

	const no = (i: number) => "No." + String(i + 1).padStart(3, "0");

	// 侧栏数据：标签频次 top 10 + 最新 5 篇（均从已下发的 posts 派生，无额外请求）
	const tagCounts = $derived.by(() => {
		const m = new Map<string, number>();
		for (const p of data.posts) for (const t of p.tags || []) m.set(t, (m.get(t) ?? 0) + 1);
		return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
	});
	const recent = $derived(
		[...data.posts].sort((a: any, b: any) => String(b.date).localeCompare(String(a.date))).slice(0, 5)
	);
</script>

<Seo
	title="博客"
	description="Stelarith 博客：记录开发实践、项目复盘、工具与生活的随笔。"
	path="/posts"
/>

<Container>
	<div class="layout-grid">
		<div class="main-col">
			<header class="ex-sheet-head">
				<div>
					<p class="ex-eyebrow slash">Blog / Posts</p>
					<h1 class="ex-bar-title">博客</h1>
				</div>
				<p class="ex-field">共 {data.posts.length} 篇</p>
			</header>

			<label class="ex-search">
				<input
					type="search"
					bind:value={keyword}
					placeholder="搜索标题、标签、摘要"
					aria-label="搜索文章"
				/>
			</label>

			<div class="chips">
				{#each data.categories as c (c)}
					<button
						type="button"
						class="ex-chip"
						class:is-active={activeCategory === c}
						aria-pressed={activeCategory === c}
						onclick={() => (activeCategory = c)}
					>
						{c}
					</button>
				{/each}
			</div>

			{#if filtered.length > 0}
				<ol class="ex-records">
					{#each filtered as post, i (post.slug)}
						<li>
							<a class="ex-record" href="/posts/{post.slug}">
								<span class="ex-tag" class:is-current={post.pinned}>{post.pinned ? "置顶" : no(i)}</span>
								<time class="ex-field">{post.date}</time>
								<span class="name ex-read">{post.title}</span>
								<span class="ex-field">{post.words ? post.words.toLocaleString() + " 字" : ""}</span>
							</a>
						</li>
					{/each}
				</ol>
			{:else}
				<p class="ex-empty">没有找到相关文章。换个关键词或分类试试。</p>
			{/if}
		</div>

		<aside class="side" aria-label="侧边栏导航">
			<div class="side-block">
				<p class="ex-eyebrow slash">分类</p>
				<ul class="side-list">
					{#each data.categories as c (c)}
						<li>
							<button
								type="button"
								class="side-link"
								class:active={activeCategory === c}
								aria-pressed={activeCategory === c}
								onclick={() => (activeCategory = c)}
							>
								{c}
							</button>
						</li>
					{/each}
				</ul>
			</div>

			{#if tagCounts.length}
				<div class="side-block">
					<p class="ex-eyebrow slash">标签</p>
					<ul class="side-tags">
						{#each tagCounts as [t, n] (t)}
							<li>
								<button type="button" class="ex-chip as-tag" onclick={() => (keyword = t)} title={`按「${t}」筛选`}>
									{t}<span class="ex-field">{n}</span>
								</button>
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			<div class="side-block">
				<p class="ex-eyebrow slash">最近</p>
				<ul class="side-list">
					{#each recent as p (p.slug)}
						<li><a class="side-link" href="/posts/{p.slug}">{p.title}</a></li>
					{/each}
				</ul>
			</div>
		</aside>
	</div>
</Container>

<style>
	.layout-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 13rem;
		gap: 2.5rem;
		align-items: start;
		padding-block: 2rem;
	}
	.ex-search {
		display: block;
		margin-top: 1.5rem;
		max-width: 28rem;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin: 1.25rem 0 1.75rem;
	}
	/* 右侧侧栏：sticky，三块分组，当前项左亮线（与详情页 toc 同语言） */
	.side {
		position: sticky;
		top: 5rem;
		align-self: start;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}
	.side-block {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.side-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.side-link {
		display: block;
		width: 100%;
		text-align: left;
		font: inherit;
		font-size: 0.82rem;
		line-height: 1.4;
		color: var(--ex-ink-2);
		background: none;
		border: none;
		border-left: 2px solid transparent;
		padding: 0.1rem 0 0.1rem 0.55rem;
		cursor: pointer;
		text-decoration: none;
		transition: color 0.2s, border-color 0.2s;
	}
	.side-link:hover { color: var(--ex-ink); }
	.side-link.active {
		color: var(--ex-ink);
		border-left-color: var(--ex-signal);
		font-weight: 600;
	}
	.side-tags {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.side-tags .ex-chip { font-size: 0.72rem; }
	.side-tags .ex-chip .ex-field { margin-left: 0.35rem; font-size: 0.68rem; opacity: 0.75; }
	.as-tag { clip-path: none; cursor: pointer; }
	@media (max-width: 1023px) {
		.layout-grid { grid-template-columns: 1fr; }
		.side { display: none; }
	}
</style>
