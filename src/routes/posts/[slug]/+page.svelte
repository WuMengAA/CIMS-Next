<script lang="ts">
	import { ArrowLeft, Calendar, Folder, Tag } from "@lucide/svelte";
	import Container from "$lib/components/container.svelte";
	import Seo from "$lib/components/Seo.svelte";
	import ViewTracker from "$lib/components/view-tracker.svelte";

	let { data }: { data: { post: any; html: string; words: number; siteUrl: string } } = $props();

	const post = $derived(data.post);
	const url = $derived(`${data.siteUrl}/posts/${post.slug}`);

	// 结构化数据：Article（正文实体）+ BreadcrumbList（面包屑）。
	// 这是"让搜索引擎收录并展示富媒体结果"的主要杠杆 —— 只有 meta 标签时，
	// 结果里只会出现一行蓝字；有 Article 才能带出作者/日期/站点名。
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
	<div class="flex flex-col gap-6 py-10">
		<a
			href="/posts"
			class="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
		>
			<ArrowLeft class="size-4" />
			返回博客
		</a>

		<header class="flex flex-col gap-4">
			<h1 class="text-3xl font-semibold tracking-tight md:text-4xl">{post.title}</h1>
			<div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
				{#if post.date}
					<span class="inline-flex items-center gap-1.5">
						<Calendar class="size-4" />
						<time datetime={post.date}>{post.date}</time>
					</span>
				{/if}
				{#if post.category}
					<span class="inline-flex items-center gap-1.5">
						<Folder class="size-4" />
						{post.category}
					</span>
				{/if}
				{#if post.updated && post.updated !== post.date}
					<span class="text-xs">更新于 {post.updated}</span>
				{/if}
			</div>
			{#if (post.tags || []).length}
				<div class="flex flex-wrap items-center gap-2">
					<Tag class="size-3.5 text-muted-foreground" />
					{#each post.tags as t (t)}
						<span class="rounded-full border border-border/60 px-2.5 py-0.5 text-xs text-muted-foreground">
							{t}
						</span>
					{/each}
				</div>
			{/if}
		</header>

		<!-- 正文：与 docs/[slug] 同一套 prose 类，保证全站文章排版一致 -->
		<article class="prose rhine-reveal ef-drop-cap max-w-none border-t border-border/70 px-1 pt-6">
			{@html data.html}
		</article>
	</div>
</Container>
