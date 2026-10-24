<script lang="ts">
	// 归档总览 · 终末地 reading（2026-10-24 铺完）：记录行列表 + 版本抽屉 + 回滚。
	// 回滚用终末地双按钮确认对话框（还原截图 02），加载用五箭头指示器（还原截图 01）。
	import "../endfield-kit.css";
	import { onMount } from "svelte";
	import Seo from "$lib/components/Seo.svelte";
	import Container from "$lib/components/container.svelte";
	import Loader from "$lib/components/endfield/loader.svelte";
	import ConfirmDialog from "$lib/components/endfield/confirm-dialog.svelte";

	interface Item {
		section: string;
		slug: string;
		title: string;
		versions: number;
		latestAt: string;
	}
	let items = $state<Item[]>([]);
	let loading = $state(true);

	let open = $state(false);
	let cur = $state<Item | null>(null);
	let versions = $state<{ id: string; version: number; savedAt: string; editor: string; size: number }[]>([]);
	let previewRaw = $state("");
	let previewId = $state("");
	let busy = $state(false);
	let msg = $state("");

	// 回滚确认
	let confirmOpen = $state(false);
	let pendingVid = $state("");

	const sectionLabel: Record<string, string> = { posts: "博客", projects: "项目", docs: "教程", pages: "页面" };

	async function load() {
		loading = true;
		try {
			const res = await fetch("/api/archive");
			if (res.ok) {
				const d = await res.json();
				items = d.items;
			}
		} catch {
			/* ignore */
		}
		loading = false;
	}

	async function openItem(it: Item) {
		cur = it;
		open = true;
		previewRaw = "";
		previewId = "";
		msg = "";
		const res = await fetch(`/api/archive?section=${it.section}&slug=${encodeURIComponent(it.slug)}`);
		if (res.ok) {
			const d = await res.json();
			versions = d.versions;
		} else versions = [];
	}

	async function preview(vid: string) {
		if (!cur) return;
		busy = true;
		const res = await fetch(
			`/api/archive?section=${cur.section}&slug=${encodeURIComponent(cur.slug)}&version=${vid}`
		);
		if (res.ok) {
			const d = await res.json();
			previewRaw = d.raw;
			previewId = vid;
		}
		busy = false;
	}

	function askRestore(vid: string) {
		if (!vid) return;
		pendingVid = vid;
		confirmOpen = true;
	}

	async function doRestore() {
		if (!cur || !pendingVid) return;
		busy = true;
		msg = "";
		try {
			const res = await fetch("/api/archive", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ section: cur.section, slug: cur.slug, version: pendingVid })
			});
			if (res.ok) {
				msg = "已回滚到该版本";
				await openItem(cur);
			} else msg = "回滚失败：需要管理员/审核权限";
		} finally {
			busy = false;
			confirmOpen = false;
			pendingVid = "";
		}
	}

	onMount(load);
</script>

<Seo title="归档" description="全站内容归档总览。" path="/archive" />

<Container>
	<header class="ex-sheet-head">
		<div>
			<p class="ex-eyebrow slash">Archive / Snapshots</p>
			<h1 class="ex-bar-title">归档</h1>
		</div>
		<p class="ex-field">{items.length} 份内容 · 历史版本快照</p>
	</header>

	{#if loading}
		<div class="loading-wrap"><Loader label="读取归档" /></div>
	{:else if items.length === 0}
		<p class="ex-empty">暂无归档记录。保存内容后会自动生成版本快照，列在这里。</p>
	{:else}
		<ol class="ex-records">
			{#each items as it, i (it.section + it.slug)}
				<li>
					<button
						type="button"
						class="ex-record as-row ex-in-come"
						style="--i:{i}"
						onclick={() => openItem(it)}
					>
						<span class="ex-tag kind">{sectionLabel[it.section] ?? it.section}</span>
						<span class="name ex-read">{it.title}</span>
						<span class="ex-field">{it.versions} 版</span>
						<span class="ex-field">{new Date(it.latestAt).toLocaleDateString("zh-CN")}</span>
					</button>
				</li>
			{/each}
		</ol>
	{/if}
</Container>

<!-- 版本抽屉 -->
{#if open && cur}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_interactive_supports_focus -->
	<div class="scrim" role="presentation" onclick={() => (open = false)}>
		<div class="drawer" role="dialog" aria-modal="true" aria-label="版本历史" tabindex="-1" onclick={(e) => e.stopPropagation()}>
			<header class="dr-head">
				<div>
					<p class="ex-eyebrow slash">{sectionLabel[cur.section] ?? cur.section} / Versions</p>
					<h2 class="dr-title">{cur.title}</h2>
				</div>
				<button class="dr-x" type="button" onclick={() => (open = false)} aria-label="关闭">✕</button>
			</header>
			<div class="dr-body">
				<ol class="dr-list">
					{#each versions as v (v.id)}
						<li>
							<button type="button" class:cur={previewId === v.id} onclick={() => preview(v.id)}>
								<span class="vno">v{v.version}</span>
								<span class="vmeta">{new Date(v.savedAt).toLocaleString("zh-CN")}</span>
								<span class="vmeta">{v.editor} · {(v.size / 1024).toFixed(1)}KB</span>
							</button>
						</li>
					{/each}
				</ol>
				<div class="dr-prev">
					{#if busy}
						<p class="ex-field">读取中…</p>
					{:else if previewRaw}
						<pre>{previewRaw}</pre>
					{:else}
						<p class="ex-empty">选择左侧版本查看快照内容。</p>
					{/if}
				</div>
			</div>
			<footer class="dr-foot">
				{#if msg}<span class="ex-field msg">{msg}</span>{/if}
				<button type="button" class="ex-btn small" disabled={!previewId || busy} onclick={() => preview(previewId)}>预览</button>
				<button type="button" class="ex-btn small danger" disabled={!previewId || busy} onclick={() => askRestore(previewId)}>回滚此版本</button>
			</footer>
		</div>
	</div>
{/if}

<ConfirmDialog
	open={confirmOpen}
	flag="回滚确认"
	title="确定回滚到该版本？"
	message="当前内容会先存为新快照再回滚，回滚后仍可再次恢复。"
	dangerLabel="确认回滚"
	safeLabel="取消"
	onDanger={doRestore}
	onSafe={() => (confirmOpen = false)}
	onClose={() => (confirmOpen = false)}
/>

<style>
	.loading-wrap {
		display: grid;
		place-items: center;
		padding: 3rem 0;
	}
	.as-row {
		display: flex;
		align-items: baseline;
		gap: 0.9rem;
	}
	.as-row .kind {
		flex: 0 0 auto;
	}
	.as-row .name {
		flex: 1 1 auto;
		min-width: 0;
		text-align: left;
	}
	.ex-record {
		width: 100%;
		text-align: left;
		background: none;
		border: 0;
		cursor: pointer;
	}
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 70;
		display: flex;
		justify-content: flex-end;
		background: color-mix(in srgb, var(--ex-ink) 46%, transparent);
	}
	.drawer {
		width: min(48rem, 100%);
		height: 100%;
		background: var(--ex-paper);
		display: flex;
		flex-direction: column;
		border-left: 1px solid var(--ex-ink);
		animation: dr-in 0.3s var(--ex-mech, cubic-bezier(0.7, 0, 0.2, 1));
	}
	.dr-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.1rem 1.3rem;
		border-bottom: 1px solid var(--ex-rule);
	}
	.dr-title {
		margin: 0.3rem 0 0;
		font-family: var(--ex-font-ui);
		font-weight: 800;
		font-size: 1.15rem;
	}
	.dr-x {
		background: none;
		border: 0;
		font-size: 1rem;
		color: var(--ex-ink-2);
		cursor: pointer;
	}
	.dr-body {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: 12rem minmax(0, 1fr);
	}
	.dr-list {
		list-style: none;
		margin: 0;
		padding: 0.6rem;
		border-right: 1px solid var(--ex-rule);
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.dr-list button {
		width: 100%;
		text-align: left;
		background: none;
		border: 0;
		padding: 0.5rem 0.55rem;
		cursor: pointer;
		border-left: 2px solid transparent;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.dr-list button:hover {
		background: var(--ex-panel);
	}
	.dr-list button.cur {
		border-left-color: var(--ex-trace);
		background: var(--ex-panel);
	}
	.vno {
		font-family: var(--ex-font-ui);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.vmeta {
		font-size: 0.68rem;
		color: var(--ex-ink-2);
		font-variant-numeric: tabular-nums;
	}
	.dr-prev {
		overflow: auto;
		padding: 0.9rem 1.1rem;
	}
	.dr-prev pre {
		margin: 0;
		white-space: pre-wrap;
		word-break: break-word;
		font-size: 0.78rem;
		line-height: 1.7;
	}
	.dr-foot {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		justify-content: flex-end;
		padding: 0.8rem 1.1rem;
		border-top: 1px solid var(--ex-rule);
	}
	.dr-foot .msg {
		margin-right: auto;
		color: var(--ex-ink);
	}
	@keyframes dr-in {
		from {
			transform: translateX(24px);
			opacity: 0;
		}
		to {
			transform: translateX(0);
			opacity: 1;
		}
	}
	@media (max-width: 720px) {
		.dr-body {
			grid-template-columns: 1fr;
		}
		.dr-list {
			border-right: 0;
			border-bottom: 1px solid var(--ex-rule);
			max-height: 10rem;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.drawer {
			animation: none;
		}
	}
</style>
