<script lang="ts">
	// 公告 · 终末地 reading 列表（2026-10-21）
	// 去彩色边框/图标，统一 ex-notice（白底细框 + 黄旗）+ ex-sheet-head 页头；
	// 置顶用 ex-state。保留 noindex（时效性内容不进搜索）。
	import "../endfield-kit.css";
	import Seo from "$lib/components/Seo.svelte";
	import Container from "$lib/components/container.svelte";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();
</script>

<Seo title="公告" description="站点公告与重要通知" path="/announcements" noindex />

<Container>
	<header class="ex-sheet-head">
		<div>
			<p class="ex-eyebrow slash">Announcements</p>
			<h1 class="ex-bar-title">公告</h1>
		</div>
		<p class="ex-field">共 {data.announcements.length} 条</p>
	</header>

	{#if data.announcements.length === 0}
		<p class="ex-empty">暂无公告。站点动态、维护通知与重要提醒会发布在这里。</p>
	{:else}
		<div class="list">
			{#each data.announcements as a, i (a.id)}
				<article class="ex-notice ex-in-come" style="--i:{i}" data-flag={a.pinned ? "置顶" : "公告"}>
					<div class="row">
						<h2 class="ex-read">{a.title}</h2>
						{#if a.pinned}<span class="ex-state">置顶</span>{/if}
						<time class="ex-field">{a.createdAt?.slice(0, 10)}</time>
					</div>
					{#if a.content}
						<p class="ex-read body">{a.content}</p>
					{/if}
				</article>
			{/each}
		</div>
	{/if}
</Container>

<style>
	.list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		margin-top: 1.5rem;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.75rem;
	}
	.row h2 {
		font-size: 1.15rem;
		font-weight: 700;
	}
	.body {
		margin-top: 0.5rem;
		white-space: pre-wrap;
		line-height: 1.8;
	}
</style>
