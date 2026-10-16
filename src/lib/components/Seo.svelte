<script lang="ts">
	/**
	 * 全站统一的 SEO 头部组件。
	 *
	 * 为什么要有它：此前每个页面各写各的 `<svelte:head>`，结果 meta 参差不齐 ——
	 * 有的连 description 都没有，有的缺 og:url，全站 JSON-LD 为零。
	 * 收口到一个组件后，新增页面只要传标题/摘要/路径，canonical、OG、Twitter、
	 * 结构化数据一次性齐活，不会再出现"某个页面忘了写"。
	 *
	 * 用法：
	 *   <Seo title="文章标题" description="摘要" path="/posts/foo"
	 *        ogType="article" publishedTime={...} jsonLd={[{...}]} />
	 *
	 * - `path` 是站内路径（如 `/projects/xingjikong`），组件会拼上 PUBLIC_SITE_URL
	 *   生成 canonical 与 og:url。传空串 = 不输出 canonical（用于不想抢占首选域的页面）。
	 * - `jsonLd` 接受对象数组，一次可挂多段结构化数据（Article + BreadcrumbList 等）。
	 * - `noindex` 给后台/预览类页面用，输出 `noindex, nofollow`。
	 */
	import { env as publicEnv } from "$env/dynamic/public";

	let {
		title,
		description = "",
		path = "",
		ogType = "website",
		jsonLd = [],
		noindex = false,
		publishedTime,
		modifiedTime,
		author,
		tags = []
	}: {
		title: string;
		description?: string;
		/** 站内路径，用于生成 canonical / og:url；空串则不输出 */
		path?: string;
		ogType?: string;
		/** 结构化数据对象数组；会自动包成 <script type="application/ld+json"> */
		jsonLd?: Array<Record<string, unknown>>;
		noindex?: boolean;
		publishedTime?: string;
		modifiedTime?: string;
		author?: string;
		tags?: string[];
	} = $props();

	const base = (publicEnv.PUBLIC_SITE_URL || "").replace(/\/+$/, "");
	const fullTitle = $derived(title ? `${title} | Stelarith` : "Stelarith");
	const desc = $derived((description || "").trim());
	// canonical 只在「配了站点域名」且「传了路径」时才输出：域名缺失时给相对路径
	// 是无效 canonical，不如不给，让搜索引擎自己定。
	const url = $derived(base && path ? base + path : "");
	// JSON-LD 文本里若出现 script 的闭合标签字面量，会提前终止外层的 script 元素，
	// 把 < 统一转义成 \u003c 是标准规避做法。
	const ldJson = $derived(JSON.stringify(jsonLd.filter(Boolean)).replace(/</g, "\\u003c"));
</script>

<svelte:head>
	<title>{fullTitle}</title>
	{#if desc}
		<meta name="description" content={desc} />
	{/if}
	{#if noindex}
		<meta name="robots" content="noindex, nofollow" />
	{/if}
	{#if url}
		<link rel="canonical" href={url} />
		<meta property="og:url" content={url} />
	{/if}
	<meta property="og:title" content={title || "Stelarith"} />
	{#if desc}
		<meta property="og:description" content={desc} />
	{/if}
	<meta property="og:type" content={ogType} />
	<meta property="og:site_name" content="Stelarith" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={title || "Stelarith"} />
	{#if desc}
		<meta name="twitter:description" content={desc} />
	{/if}
	{#if author}
		<meta name="author" content={author} />
	{/if}
	{#if ogType === "article"}
		{#if publishedTime}
			<meta property="article:published_time" content={publishedTime} />
		{/if}
		{#if modifiedTime}
			<meta property="article:modified_time" content={modifiedTime} />
		{/if}
		{#each tags as t (t)}
			<meta property="article:tag" content={t} />
		{/each}
	{/if}
	{#if jsonLd.length}
		{@html `<script type="application/ld+json">${ldJson}</script>`}
	{/if}
</svelte:head>
