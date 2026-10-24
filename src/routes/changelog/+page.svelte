<script lang="ts">
	// 更新日志 · 终末地 reading（2026-10-24 铺完）：版本记录行 + 种类筛选 + 搜索 + 开发进度台账。
	import "../endfield-kit.css";
	import Seo from "$lib/components/Seo.svelte";
	import Container from "$lib/components/container.svelte";

	let { data }: { data: import("./$types").PageData } = $props();

	// 纯展示常量，内联（不能从 $lib/server/* import，SvelteKit 守卫会拦浏览器侧引用）
	const KIND_LABELS: Record<string, string> = {
		feat: "新增",
		fix: "修复",
		change: "调整",
		chore: "其它"
	};

	let filter = $state("all");
	let keyword = $state("");

	const filtered = $derived(
		data.entries.map((e) => ({
			...e,
			items: e.items.filter(
				(i) =>
					(filter === "all" || i.kind === filter) &&
					(!keyword.trim() ||
						(e.title + e.highlight + i.text).toLowerCase().includes(keyword.trim().toLowerCase()))
			)
		}))
	);
	const shown = $derived(filtered.filter((e) => e.items.length > 0));
</script>

<Seo
	title="更新日志"
	description="每一次改动都记下来：新增了什么、修了什么、调整了什么。"
	path="/changelog"
/>

<Container>
	<header class="ex-sheet-head">
		<div>
			<p class="ex-eyebrow slash">Changelog</p>
			<h1 class="ex-bar-title">更新日志</h1>
		</div>
		<p class="ex-field">共 {data.entries.length} 个版本</p>
	</header>

	<!-- 筛选 + 搜索 -->
	<div class="toolbar">
		<div class="chips">
			<button
				type="button"
				class="ex-chip"
				class:is-active={filter === "all"}
				aria-pressed={filter === "all"}
				onclick={() => (filter = "all")}
			>全部 <span class="n">{data.entries.length}</span></button>
			{#each data.counts as c (c.kind)}
				{#if c.n}
					<button
						type="button"
						class="ex-chip"
						class:is-active={filter === c.kind}
						aria-pressed={filter === c.kind}
						onclick={() => (filter = c.kind)}
					>{c.label} <span class="n">{c.n}</span></button>
				{/if}
			{/each}
		</div>
		<label class="ex-search">
			<input type="search" bind:value={keyword} placeholder="搜索改动" aria-label="搜索改动" />
		</label>
	</div>

	<!-- 开发进度台账 -->
	{#if data.roadmap.items.length}
		<section class="ledger-wrap">
			<h2 class="ex-group-head"><span>开发进度</span><span class="ex-field">{data.roadmap.updated || ""}</span></h2>
			<ul class="ex-ledger">
				{#each data.roadmap.items as r (r.project)}
					<li>
						<span>{r.project} <em class="ex-field">{r.phase}</em></span>
						<span class="val" class:warn={r.progress >= 80}>{r.progress}%</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<!-- 版本记录 -->
	<div class="versions">
		{#each shown as e (e.version)}
			<section class="ver">
				<h2 class="ex-group-head">
					<span><span class="vtag">{e.version}</span> {e.title}</span>
					<span class="ex-field">{e.date}</span>
				</h2>
				{#if e.highlight}<p class="hl ex-read">{e.highlight}</p>{/if}
				<ol class="ex-records">
					{#each e.items as it, i (i)}
						<li>
							<div class="ex-record as-row ex-in-come" style="--i:{i}">
								<span class="ex-tag kind" data-kind={it.kind}>{KIND_LABELS[it.kind] ?? "其它"}</span>
								<span class="name ex-read">{it.text}</span>
							</div>
						</li>
					{/each}
				</ol>
			</section>
		{:else}
			<p class="ex-empty">没有匹配的改动记录。换个种类或关键词试试。</p>
		{/each}
	</div>
</Container>

<style>
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.8rem;
		margin: 0.4rem 0 1.6rem;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.chips .n {
		font-variant-numeric: tabular-nums;
		opacity: 0.7;
		margin-left: 0.15rem;
	}
	.ex-search {
		margin-left: auto;
		min-width: 12rem;
		flex: 0 1 16rem;
	}
	.ledger-wrap {
		margin-bottom: 2rem;
	}
	.versions {
		display: flex;
		flex-direction: column;
		gap: 2.2rem;
	}
	.ver {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}
	.vtag {
		font-family: var(--ex-font-ui);
		font-weight: 800;
		font-stretch: var(--ex-wide);
		color: var(--ex-on-signal);
		background: var(--ex-signal);
		padding: 0.08em 0.45em;
		margin-right: 0.5rem;
		font-variant-numeric: tabular-nums;
	}
	.hl {
		margin: 0;
		color: var(--ex-ink-2);
		font-size: 0.92rem;
		line-height: 1.7;
	}
	.as-row {
		display: flex;
		gap: 0.9rem;
		align-items: baseline;
	}
	.as-row .kind {
		flex: 0 0 auto;
	}
	.as-row .kind[data-kind="feat"] {
		background: var(--ex-ink);
		color: var(--ex-panel);
	}
	.as-row .kind[data-kind="fix"] {
		background: var(--ex-chip);
		color: var(--ex-ink);
	}
	.as-row .kind[data-kind="change"] {
		background: transparent;
		color: var(--ex-ink-2);
		border: 1px solid var(--ex-rule);
	}
	.as-row .kind[data-kind="chore"] {
		background: transparent;
		color: var(--ex-ink-2);
		border: 1px dashed var(--ex-rule);
	}
	.as-row .name {
		min-width: 0;
	}
	.ex-ledger .val.warn {
		background: var(--ex-signal);
		color: var(--ex-on-signal);
		padding: 0 0.4rem;
	}
	.ex-ledger em {
		font-style: normal;
		opacity: 0.75;
	}
</style>
