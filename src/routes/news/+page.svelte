<script lang="ts">
	// 新闻聚合 · 终末地 reading 列表（2026-10-21）
	import "../endfield-kit.css";
	import Container from "$lib/components/container.svelte";
	import Seo from "$lib/components/Seo.svelte";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	function fmtDate(iso?: string): string {
		if (!iso) return "";
		const d = new Date(iso);
		if (isNaN(d.getTime())) return "";
		return d.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
	}
</script>

<Seo title="新闻聚合" description="聚合自知名新闻与博客订阅源的热门内容。" path="/news" />

<Container>
	<header class="ex-sheet-head">
		<div>
			<p class="ex-eyebrow slash">News / Feed</p>
			<h1 class="ex-bar-title">新闻聚合</h1>
		</div>
		<a class="ex-btn small" href="/rss.xml" target="_blank" rel="noopener noreferrer">订阅 RSS</a>
	</header>

	{#if data.error}
		<p class="ex-empty">{data.error}</p>
	{:else if data.items.length === 0}
		<p class="ex-empty">暂无聚合内容（可能源暂不可达，或尚未抓取完成，稍后刷新看看）。</p>
	{:else}
		<ol class="ex-records">
			{#each data.items as it, i (it.guid || it.link || it.title)}
				<li>
					<a class="ex-record ex-in-come" style="--i:{i}" href={it.link} target="_blank" rel="noopener noreferrer">
						<span class="ex-tag" class:is-current={it.internal}>{it.internal ? "精选" : it.source || "外源"}</span>
						<time class="ex-field">{fmtDate(it.pubDate)}</time>
						<span class="name ex-read">{it.title}{#if it.description}<span class="desc">{it.description}</span>{/if}</span>
						<span class="ex-field">{it.category || ""} ↗</span>
					</a>
				</li>
			{/each}
		</ol>
		<p class="foot ex-field">内容每 10 分钟聚合刷新：外部订阅源约占 7 成（版权归原作者），站内精选约占 3 成。</p>
	{/if}
</Container>

<style>
	.foot { margin-top: 1.5rem; }
	.name .desc {
		display: block;
		margin-top: 0.2rem;
		font-size: 0.85em;
		color: var(--ex-ink-2);
	}
</style>
