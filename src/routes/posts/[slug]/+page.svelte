<script lang="ts">
	// 博客详情 · 终末地 reading（2026-10-22）：页头 + 正文 + 右侧目录(scrollspy) + 文末上/下一篇。
	import "../../endfield-kit.css";
	import Container from "$lib/components/container.svelte";
	import Seo from "$lib/components/Seo.svelte";
	import ViewTracker from "$lib/components/view-tracker.svelte";
	import { onMount } from "svelte";

	let { data }: { data: { post: any; html: string; words: number; prev: any; next: any; siteUrl: string } } = $props();

	const post = $derived(data.post);
	const url = $derived(`${data.siteUrl}/posts/${post.slug}`);

	const jsonLd = $derived([
		{
			"@context": "https://schema.org",
			"@type": "Article",
			headline: post.title,
			description: post.excerpt || post.title,
			datePublished: post.date,
			dateModified: post.updated || post.date,
			author: { "@type": "Organization", name: "Stelarith" },
			publisher: { "@type": "Organization", name: "Stelarith" },
			mainEntityOfPage: url,
			keywords: (post.tags || []).join(", "),
			wordCount: data.words,
			inLanguage: "zh-CN"
		},
		{
			"@context": "https://schema.org",
			"@type": "BreadcrumbList",
			itemListElement: [
				{ "@type": "ListItem", position: 1, name: "首页", item: data.siteUrl },
				{ "@type": "ListItem", position: 2, name: "博客", item: `${data.siteUrl}/posts` },
				{ "@type": "ListItem", position: 3, name: post.title, item: url }
			]
		}
	]);

	// 目录：客户端从 prose 的 h2/h3 提取（无 id 则按文本生成），IntersectionObserver 高亮当前节。
	let toc = $state<{ id: string; text: string; level: number }[]>([]);
	let activeId = $state("");
	onMount(() => {
		const art = document.querySelector<HTMLElement>(".detail .prose");
		if (!art) return;
		const hs = Array.from(art.querySelectorAll<HTMLElement>("h2, h3"));
		if (!hs.length) return;
		const slug = (t: string) =>
			"h-" + t.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40);
		const used = new Set<string>();
		toc = hs.map((h) => {
			let id = h.id || slug(h.textContent || "");
			while (used.has(id) || !id) id = id + "-x";
			used.add(id);
			h.id = id;
			return { id, text: (h.textContent || "").trim(), level: h.tagName === "H2" ? 2 : 3 };
		});
		const obs = new IntersectionObserver(
			(entries) => {
				const vis = entries
					.filter((e) => e.isIntersecting)
					.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
				if (vis.length) activeId = vis[0].target.id;
			},
			{ rootMargin: "-90px 0px -65% 0px", threshold: 0 }
		);
		hs.forEach((h) => obs.observe(h));
		return () => obs.disconnect();
	});
</script>

<Seo
	title={post.title}
	description={post.excerpt || post.title}
	path={`/posts/${post.slug}`}
	ogType="article"
	publishedTime={post.date}
	modifiedTime={post.updated || post.date}
	tags={post.tags || []}
	{jsonLd}
/>

<ViewTracker target={"posts:" + post.slug} />

<Container>
	<div class="detail">
		<p class="ex-crumb ex-field"><a href="/posts">全部文章</a><span>{post.category || "未分类"}</span></p>

		<h1 class="ex-read title">{post.title}</h1>

		<ul class="ex-facts ex-field">
			{#if post.date}<li><time datetime={post.date}>{post.date}</time></li>{/if}
			<li>{data.words ? data.words.toLocaleString() + " 字" : ""}</li>
			{#if post.category}<li>{post.category}</li>{/if}
			{#if post.updated && post.updated !== post.date}<li>更新于 {post.updated}</li>{/if}
		</ul>

		{#if (post.tags || []).length}
			<div class="tags">
				{#each post.tags as t (t)}
					<span class="ex-chip as-tag">{t}</span>
				{/each}
			</div>
		{/if}

		<div class="body-grid">
			<article class="prose max-w-none">
				{@html data.html}
			</article>

			{#if toc.length}
				<aside class="toc" aria-label="目录">
					<p class="ex-eyebrow slash">Contents</p>
					<ol>
						{#each toc as t (t.id)}
							<li class:lvl3={t.level === 3}>
								<a href={"#" + t.id} class:active={activeId === t.id}>{t.text}</a>
							</li>
						{/each}
					</ol>
				</aside>
			{/if}
		</div>

		{#if data.prev || data.next}
			<nav class="prevnext" aria-label="上/下一篇">
				{#if data.prev}
					<a class="ex-record" href="/posts/{data.prev.slug}">
						<span class="ex-tag">← 上一篇</span>
						<span class="name ex-read">{data.prev.title}</span>
						<time class="ex-field">{data.prev.date}</time>
					</a>
				{/if}
				{#if data.next}
					<a class="ex-record" href="/posts/{data.next.slug}">
						<span class="ex-tag">下一篇 →</span>
						<span class="name ex-read">{data.next.title}</span>
						<time class="ex-field">{data.next.date}</time>
					</a>
				{/if}
			</nav>
		{/if}
	</div>
</Container>

<style>
	.detail {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		padding-block: 2rem;
	}
	.body-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 13rem;
		gap: 2.5rem;
		align-items: start;
	}
	.title {
		font-size: clamp(1.9rem, 4vw, 2.6rem);
		font-weight: 800;
		line-height: 1.2;
		letter-spacing: -0.01em;
	}
	/* 右侧目录：sticky，当前节左边亮黄线 */
	.toc {
		position: sticky;
		top: 5rem;
		align-self: start;
	}
	.toc ol {
		list-style: none;
		margin: 0.5rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.toc a {
		display: block;
		font-size: 0.82rem;
		line-height: 1.4;
		color: var(--ex-ink-2);
		text-decoration: none;
		border-left: 2px solid transparent;
		padding-left: 0.55rem;
		transition: color 0.2s, border-color 0.2s;
	}
	.toc li.lvl3 a {
		padding-left: 1.2rem;
		font-size: 0.78rem;
	}
	.toc a:hover { color: var(--ex-ink); }
	.toc a.active {
		color: var(--ex-ink);
		border-left-color: var(--ex-signal);
		font-weight: 600;
	}
	/* 上/下一篇：两条记录行，宽屏双列 */
	.prevnext {
		display: grid;
		gap: 0.6rem;
		margin-top: 1.5rem;
		padding-top: 1.5rem;
		border-top: 1px solid var(--ex-rule);
	}
	.prevnext a.ex-record {
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: baseline;
	}
	@media (max-width: 1023px) {
		.body-grid { grid-template-columns: 1fr; }
		.toc { display: none; }
	}
	@media (min-width: 640px) {
		.prevnext { grid-template-columns: 1fr 1fr; }
	}
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.as-tag {
		clip-path: none;
		cursor: default;
	}
</style>
