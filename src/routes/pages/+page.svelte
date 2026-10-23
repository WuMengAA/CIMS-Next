<script lang="ts">
	// 独立页面列表 · 终末地 reading 列表（2026-10-21）
	import "../endfield-kit.css";
	import Seo from "$lib/components/Seo.svelte";
	import Container from "$lib/components/container.svelte";

	let { data }: { data: { pages: any[]; canEdit?: boolean } } = $props();
</script>

<Seo title="页面" description="独立页面与自定义内容。" path="/pages" />

<Container>
	<header class="ex-sheet-head">
		<div>
			<p class="ex-eyebrow slash">Pages</p>
			<h1 class="ex-bar-title">页面</h1>
		</div>
		<p class="ex-field">共 {data.pages.length} 个</p>
	</header>

	{#if data.pages.length === 0}
		<p class="ex-empty">
			还没有页面。{#if data.canEdit}<a href="/admin/pages/new">去新建第一个</a>{/if}
		</p>
	{:else}
		<ol class="ex-records">
			{#each data.pages as page, i (page.slug)}
				<li>
					<a class="ex-record ex-in-come" style="--i:{i}" href="/pages/{page.slug}">
						<span class="ex-tag">{String(i + 1).padStart(2, "0")}</span>
						<time class="ex-field">{page.date || ""}</time>
						<span class="name ex-read">{page.title}{#if page.excerpt}<span class="desc">{page.excerpt}</span>{/if}</span>
					</a>
				</li>
			{/each}
		</ol>
	{/if}
</Container>

<style>
	.name .desc {
		display: block;
		margin-top: 0.2rem;
		font-size: 0.85em;
		color: var(--ex-ink-2);
	}
</style>
