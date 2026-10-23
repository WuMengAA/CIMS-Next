<script lang="ts">
	// 旧站归档 · 终末地 reading 列表（2026-10-21）
	import "../endfield-kit.css";
	import Seo from "$lib/components/Seo.svelte";
	import Container from "$lib/components/container.svelte";

	const versions = [
		{ tag: "v19", title: "Astro 一体化主站", tech: "Astro + React", year: "2026" },
		{ tag: "v18", title: "Vuetify 重构", tech: "Vue + Vuetify", year: "2026" },
		{ tag: "v17", title: "React CSR → SSR", tech: "React", year: "2025" },
		{ tag: "SVAF", title: "SvelteKit + shadcn 时代", tech: "SvelteKit + shadcn-svelte", year: "2025" },
		{ tag: "v16", title: "Hexo 主题时代", tech: "Hexo", year: "2024" },
		{ tag: "v15", title: "WordPress 时代", tech: "WordPress", year: "2023" }
	];
</script>

<Seo title="旧站归档" description="旧站内容归档。" path="/archives" />

<Container>
	<header class="ex-sheet-head">
		<div>
			<p class="ex-eyebrow slash">Archive / Legacy</p>
			<h1 class="ex-bar-title">旧站归档</h1>
		</div>
		<p class="ex-field">共 {versions.length} 代</p>
	</header>

	<ol class="ex-records">
		{#each versions as v, i (v.tag)}
			<li>
				<div class="ex-record as-row ex-in-come" style="--i:{i}">
					<span class="ex-tag">{v.tag}</span>
					<time class="ex-field">{v.year}</time>
					<span class="name ex-read">{v.title}</span>
					<span class="ex-field">{v.tech}</span>
				</div>
			</li>
		{/each}
	</ol>
</Container>

<style>
	.as-row {
		display: flex;
		gap: 1rem;
		align-items: baseline;
	}
</style>
