<script lang="ts">
	// 博客列表 · 终末地 reading 范式（2026-10-21）
	// 页头 ex-sheet-head + 搜索 ex-search + 分类 ex-chip + 文章 ex-records 记录行。
	// 保留原搜索/分类筛选/置顶逻辑与数据绑定，仅视觉终末地化。
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
</script>

<Seo
	title="博客"
	description="Stelarith 博客：记录开发实践、项目复盘、工具与生活的随笔。"
	path="/posts"
/>

<Container>
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
</Container>

<style>
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
</style>
