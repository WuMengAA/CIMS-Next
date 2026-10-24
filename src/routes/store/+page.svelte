<script lang="ts">
	// 还原截图 06：采购中心 —— 顶部 tab + 左侧竖排列表 + 中间 3D 商品窗 + 底部黄色 CTA。
	// 站点适配：商品=站点真实资源（客户端/模板/工具/教程），不编造价格（标"开源免费"）。
	import "../endfield-kit.css";
	import Seo from "$lib/components/Seo.svelte";

	type Item = {
		group: string;
		code: string;
		name: string;
		en: string;
		note: string;
		href: string;
		tag: string;
		free: string;
	};

	const tabs = [
		{ k: "featured", zh: "精选", en: "Featured" },
		{ k: "client", zh: "客户端", en: "Client" },
		{ k: "tpl", zh: "模板", en: "Templates" },
		{ k: "tool", zh: "工具", en: "Tools" },
		{ k: "doc", zh: "教程", en: "Docs" }
	];

	const items: Item[] = [
		{ group: "client", code: "No.001", name: "星集控 · 桌面端", en: "Stelarith Desktop", note: "教室设备集控，Windows 安装包与更新通道同源。", href: "/download", tag: "Windows", free: "开源免费" },
		{ group: "client", code: "No.002", name: "站点源码", en: "Site Source", note: "SvelteKit + PostgreSQL，含终末地主题全家桶。", href: "/projects", tag: "SvelteKit", free: "开源免费" },
		{ group: "tpl", code: "No.003", name: "文章模板 · 终末地", en: "Article Template", note: "reading 范式正文骨架，编号分节与字段行齐备。", href: "/docs", tag: "Markdown", free: "开源免费" },
		{ group: "tpl", code: "No.004", name: "页面模板预设", en: "Layout Presets", note: "版心宽度、侧栏目录、页面主色一步到位。", href: "/pages", tag: "Preset", free: "开源免费" },
		{ group: "tool", code: "No.005", name: "配色工具", en: "Color Tool", note: "终端地色板取值与对比度校验。", href: "/tools/color-tool", tag: "Web", free: "在线使用" },
		{ group: "tool", code: "No.006", name: "封面生成器", en: "Cover Generator", note: "批量出图，宽体标签与黄块编号。", href: "/tools/cover-generator", tag: "Web", free: "在线使用" },
		{ group: "tool", code: "No.007", name: "图床 / 图片处理", en: "Image Tool", note: "压图、加水印、批量导出。", href: "/tools/image-tool", tag: "Web", free: "在线使用" },
		{ group: "doc", code: "No.008", name: "部署到 CF 边缘", en: "CF Edge", note: "Tunnel 接入、优选与安全收口全流程。", href: "/docs", tag: "Guide", free: "免费阅读" }
	];

	let tab = $state("featured");
	let sel = $state(0);

	const list = $derived(
		tab === "featured" ? items : items.filter((i) => i.group === tab)
	);
	const cur = $derived<Item>(list[Math.min(sel, list.length - 1)] ?? items[0]);

	function pick(k: string) {
		tab = k;
		sel = 0;
	}
</script>

<Seo title="采购中心" description="站点资源采购中心：客户端、模板、工具与教程，一处置取。" path="/store" />

<div class="ex store">
	<!-- 顶栏 -->
	<header class="topbar">
		<a class="brand" href="/"><span class="seal">S</span>采购中心</a>
		<nav class="tabs" aria-label="资源分类">
			{#each tabs as t (t.k)}
				<button type="button" class:on={tab === t.k} onclick={() => pick(t.k)}>
					{t.zh}<small>{t.en}</small>
				</button>
			{/each}
		</nav>
		<div class="wallet">
			<span class="coin"><i aria-hidden="true">◈</i>21</span>
			<span class="coin"><i aria-hidden="true">◇</i>2,190</span>
			<a class="close" href="/" aria-label="离开采购中心">✕</a>
		</div>
	</header>

	<div class="body">
		<!-- 左：商品列表 -->
		<aside class="shelf" aria-label="商品列表">
			<ol>
				{#each list as it, i (it.code)}
					<li>
						<button type="button" class:cur={i === sel} onclick={() => (sel = i)}>
							<span class="nm">{it.name}</span>
							<span class="cd">{it.code}</span>
						</button>
					</li>
				{/each}
			</ol>
		</aside>

		<!-- 中：商品展示 -->
		<section class="showcase" aria-live="polite">
			<div class="watermark" aria-hidden="true">STELARITH</div>

			<div class="stage" aria-hidden="true">
				<div class="box">
					<span class="face top"></span>
					<span class="face left"></span>
					<span class="face right"></span>
					<span class="side-arc"></span>
				</div>
			</div>

			<div class="meta">
				<div class="titleblock">
					<p class="eyebrow slash">Store / {cur.en}</p>
					<h1>{cur.name}</h1>
					<p class="note">{cur.note}</p>
				</div>
				<div class="buy">
					<span class="price">{cur.free}</span>
					<a class="cta" href={cur.href}>前往获取 <span aria-hidden="true">→</span></a>
				</div>
			</div>

			<div class="flagline">
				<span class="flag">限时</span>
				<span>站点资源常年开放，无需付费 · <b>{cur.tag}</b></span>
			</div>
		</section>
	</div>
</div>

<style>
	.store {
		min-height: 100dvh;
		background: var(--ex-paper, #f4f4f2);
		color: var(--ex-ink, #161616);
		display: flex;
		flex-direction: column;
	}
	.topbar {
		display: flex;
		align-items: center;
		gap: 1.2rem;
		padding: 0.7rem 1.2rem;
		background: var(--ex-ink, #161616);
		color: var(--ex-paper, #f4f4f2);
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-family: var(--ex-font-ui, inherit);
		font-weight: 700;
		font-size: 0.9rem;
		color: inherit;
		text-decoration: none;
	}
	.seal {
		display: inline-grid;
		place-items: center;
		width: 1.4rem;
		height: 1.4rem;
		background: var(--ex-signal, #fffa00);
		color: var(--ex-on-signal, #161616);
		font-weight: 800;
		clip-path: polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%);
	}
	.tabs {
		display: flex;
		gap: 0.2rem;
	}
	.tabs button {
		background: none;
		border: 0;
		color: color-mix(in srgb, var(--ex-paper, #f4f4f2) 62%, transparent);
		font-family: var(--ex-font-ui, inherit);
		font-size: 0.8rem;
		font-weight: 600;
		padding: 0.45rem 0.9rem;
		cursor: pointer;
		display: inline-flex;
		align-items: baseline;
		gap: 0.4rem;
	}
	.tabs button small {
		font-size: 0.56rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		opacity: 0.7;
	}
	.tabs button.on {
		background: var(--ex-signal, #fffa00);
		color: var(--ex-on-signal, #161616);
		clip-path: polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%);
	}
	.wallet {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-family: var(--ex-font-ui, inherit);
		font-size: 0.78rem;
		font-variant-numeric: tabular-nums;
	}
	.coin {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}
	.coin i {
		font-style: normal;
		color: var(--ex-signal, #fffa00);
	}
	.close {
		color: inherit;
		text-decoration: none;
		margin-left: 0.4rem;
		opacity: 0.8;
	}
	.body {
		flex: 1;
		display: grid;
		grid-template-columns: 13rem minmax(0, 1fr);
		min-height: 0;
	}
	.shelf {
		border-right: 1px solid var(--ex-rule, #d9d9d6);
		padding: 1rem 0.6rem;
		overflow-y: auto;
	}
	.shelf ol {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.shelf button {
		width: 100%;
		text-align: left;
		background: none;
		border: 0;
		padding: 0.6rem 0.7rem;
		cursor: pointer;
		color: var(--ex-ink-2, #5c5c5c);
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.5rem;
		border-left: 3px solid transparent;
	}
	.shelf button .nm {
		font-size: 0.82rem;
	}
	.shelf button .cd {
		font-family: var(--ex-font-ui, inherit);
		font-size: 0.6rem;
		opacity: 0.6;
	}
	.shelf button:hover {
		color: var(--ex-ink, #161616);
	}
	.shelf button.cur {
		color: var(--ex-ink, #161616);
		background: var(--ex-panel, #fff);
		border-left-color: var(--ex-signal, #fffa00);
		font-weight: 600;
	}
	.showcase {
		position: relative;
		display: grid;
		grid-template-rows: 1fr auto auto;
		padding: 1.2rem 2rem 1rem;
		overflow: hidden;
	}
	.watermark {
		position: absolute;
		inset: auto 0 32% 0;
		text-align: center;
		font-family: var(--ex-font-ui, inherit);
		font-weight: 800;
		font-stretch: 125%;
		font-size: clamp(3rem, 9vw, 7rem);
		letter-spacing: 0.04em;
		color: color-mix(in srgb, var(--ex-ink, #161616) 6%, transparent);
		pointer-events: none;
		user-select: none;
	}
	.stage {
		display: grid;
		place-items: center;
		perspective: 1100px;
	}
	.box {
		position: relative;
		width: 12rem;
		height: 9rem;
		transform-style: preserve-3d;
		transform: rotateX(14deg) rotateY(-26deg);
	}
	.face {
		position: absolute;
		border: 1.5px solid var(--ex-ink, #161616);
	}
	.face.top {
		width: 12rem;
		height: 12rem;
		background: var(--ex-panel, #fff);
		transform: rotateX(90deg) translateZ(3.6rem);
	}
	.face.left {
		width: 7.4rem;
		height: 9rem;
		background: var(--ex-paper, #f4f4f2);
		transform: translateZ(0);
	}
	.face.right {
		width: 7.4rem;
		height: 9rem;
		left: 7.4rem;
		background: color-mix(in srgb, var(--ex-panel, #fff) 82%, var(--ex-ink, #161616));
		transform: rotateY(90deg) translateZ(0.2rem);
		transform-origin: left center;
	}
	.side-arc {
		position: absolute;
		left: 0;
		top: 0;
		width: 12rem;
		height: 3.2rem;
		border-top: 4px solid var(--ex-signal, #fffa00);
		border-radius: 0 0 50% 50% / 0 0 100% 100%;
		transform: rotateX(90deg) translateZ(3.55rem) translateY(-0.2rem);
	}
	.meta {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1.5rem;
		border-top: 1px solid var(--ex-rule, #d9d9d6);
		padding-top: 1rem;
	}
	.eyebrow {
		margin: 0;
		font-family: var(--ex-font-ui, inherit);
		font-size: 0.64rem;
		font-weight: 600;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--ex-ink-2, #5c5c5c);
	}
	.titleblock h1 {
		margin: 0.35rem 0 0;
		font-family: var(--ex-font-ui, inherit);
		font-weight: 800;
		font-size: clamp(1.3rem, 2.6vw, 1.9rem);
		letter-spacing: 0.01em;
	}
	.note {
		margin: 0.45rem 0 0;
		max-width: 32rem;
		font-size: 0.8rem;
		line-height: 1.6;
		color: var(--ex-ink-2, #5c5c5c);
	}
	.buy {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.5rem;
		white-space: nowrap;
	}
	.price {
		font-family: var(--ex-font-ui, inherit);
		font-weight: 800;
		font-size: 1.5rem;
		color: var(--ex-ink, #161616);
	}
	.cta {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		background: var(--ex-signal, #fffa00);
		color: var(--ex-on-signal, #161616);
		font-family: var(--ex-font-ui, inherit);
		font-weight: 700;
		font-size: 0.9rem;
		text-decoration: none;
		padding: 0.7rem 1.6rem;
		clip-path: polygon(0 0, 100% 0, 100% calc(100% - 9px), calc(100% - 9px) 100%, 0 100%);
		transition: transform 0.14s var(--ex-mech, cubic-bezier(0.7, 0, 0.2, 1));
	}
	.cta:hover {
		transform: translateY(-1px);
	}
	.flagline {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		margin-top: 0.9rem;
		padding-top: 0.8rem;
		border-top: 1px solid var(--ex-rule, #d9d9d6);
		font-size: 0.72rem;
		color: var(--ex-ink-2, #5c5c5c);
	}
	.flag {
		background: var(--ex-signal, #fffa00);
		color: var(--ex-on-signal, #161616);
		font-family: var(--ex-font-ui, inherit);
		font-weight: 700;
		padding: 0.15rem 0.5rem;
	}
	.flagline b {
		color: var(--ex-ink, #161616);
	}
	@media (max-width: 860px) {
		.body {
			grid-template-columns: 1fr;
		}
		.shelf {
			border-right: 0;
			border-bottom: 1px solid var(--ex-rule, #d9d9d6);
			max-height: 11rem;
		}
		.box {
			width: 9rem;
			height: 7rem;
		}
		.meta {
			flex-direction: column;
			align-items: flex-start;
		}
		.buy {
			align-items: flex-start;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.cta {
			transition: none;
		}
	}
</style>
