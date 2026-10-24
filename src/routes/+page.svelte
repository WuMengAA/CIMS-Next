<script lang="ts">
	// ── 首页 · 终末地 showcase 范式（2026-10-21）─────────────────────────────
	// 视觉来自 endfield-ui-skill（assets/endfield-kit.css，.ex 作用域隔离）。
	// 保留站点真实数据源与 Seo / ContinueReading。
	// 动效：kit 的 ex-in-* CSS 类（首屏自动播）+ fx.js 的数字落定/画框视差；
	//   fx.js 顶层有 matchMedia，SSR 会崩，故 onMount 内**动态 import**（仅客户端）。
	//   只接 wireReadouts / wireParallax，**绝不接 wireTheme**（主题沿用站点 mode-watcher）。
	import Seo from "$lib/components/Seo.svelte";
	import ContinueReading from "$lib/components/continue-reading.svelte";
	import "./endfield-kit.css";
	import { onMount } from "svelte";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	const s = $derived(data.settings);
	const posts = $derived(data.posts || []);
	const projects = $derived(data.projects || []);
	const docs = $derived(data.docs || []);
	const socials = $derived(data.settings.socials || []);
	const features = $derived(data.settings.features || []);
	const latest = $derived(posts[0]);
	const no = (i: number) => String(i + 1).padStart(3, "0");

	onMount(() => {
		import("$lib/endfield-fx.js").then(({ wireReadouts, wireParallax }) => {
			wireReadouts();
			wireParallax(document.querySelector("[data-hero]"));
		});
	});
</script>

<Seo
	title="首页"
	description={s.description || s.heroTitle || "Stelarith"}
	path="/"
	jsonLd={[
		{
			"@context": "https://schema.org",
			"@type": "WebSite",
			name: s.title || "Stelarith",
			description: s.description || "",
			url: data.siteUrl || "",
			inLanguage: "zh-CN",
			potentialAction: {
				"@type": "SearchAction",
				target: `${data.siteUrl || ""}/search?q={search_term_string}`,
				"query-input": "required name=search_term_string"
			}
		},
		{
			"@context": "https://schema.org",
			"@type": "Organization",
			name: s.title || "Stelarith",
			url: data.siteUrl || "",
			logo: `${data.siteUrl || ""}/avatars/default.svg`
		}
	]}
/>

<div class="ex">
	<!-- 三色条：品红 / 强调色 / 薄荷绿，页顶一次访问画出 -->
	<div class="ex-tri ex-in-sweep" aria-hidden="true"><i></i><i></i><i></i></div>

	<!-- ═══ Hero ═══ -->
	<section class="hero" data-hero>
		<p class="meta ex-field">
			<span>{s.title || "Stelarith"}</span>
			<span><b data-fx-load>{posts.length}</b> 篇文章</span>
			<span><b data-fx-load>{projects.length}</b> 个项目</span>
			<span><b data-fx-load>{docs.length}</b> 篇教程</span>
		</p>

		<h1 class="ex-wordmark">
			<span class="solid ex-in-drive">STELARITH</span>
			<span class="hollow ex-in-drive" style="animation-delay:140ms" aria-hidden="true">.WORKS</span>
		</h1>

		<div class="copy">
			<p class="claim"><span class="ex-marker ex-in-stroke">{s.slogan || s.heroBadge || "代码 · 校园 · 热爱"}</span></p>
			<p class="bio ex-read">{s.heroSubtitle}</p>
			<p class="ex-actions">
				{#if latest}
					<a class="ex-btn go" href="/posts/{latest.slug}">读最新一篇 <span class="sub">No.{no(0)}</span></a>
				{/if}
				<a class="ex-btn" href="/posts">全部文章</a>
				<a class="ex-btn" href="/projects">项目</a>
			</p>
		</div>

		<figure class="ex-frame">
			<div class="window">
				<!-- 自绘等轴测线稿（占位）：后续换站点真实视觉。不用游戏官方素材。 -->
				<svg viewBox="0 0 400 420" fill="none" stroke="currentColor" stroke-width="1.5" aria-label="Stelarith 主机台线稿">
					<!-- 侧节点 + 连线 -->
					<rect x="52" y="170" width="46" height="46" />
					<line x1="98" y1="193" x2="120" y2="193" />
					<rect x="302" y="210" width="46" height="46" />
					<line x1="280" y1="233" x2="302" y2="233" />
					<!-- 主机柜 -->
					<rect x="120" y="70" width="160" height="250" />
					<!-- 顶部显示窗 -->
					<rect x="140" y="88" width="120" height="38" />
					<text x="150" y="112" font-family="Saira, sans-serif" font-stretch="125%" font-size="13" letter-spacing="2" fill="currentColor" stroke="none">SYS / ONLINE</text>
					<!-- 三道面板 + 黄状态灯 + 标签 -->
					<line x1="120" y1="160" x2="280" y2="160" />
					<line x1="120" y1="210" x2="280" y2="210" />
					<line x1="120" y1="260" x2="280" y2="260" />
					<rect x="252" y="176" width="16" height="10" fill="#fffa00" stroke="none" />
					<rect x="252" y="226" width="16" height="10" fill="#fffa00" stroke="none" />
					<rect x="252" y="276" width="16" height="10" fill="#fffa00" stroke="none" />
					<line x1="140" y1="180" x2="180" y2="180" opacity=".5" />
					<line x1="140" y1="230" x2="200" y2="230" opacity=".5" />
					<line x1="140" y1="280" x2="170" y2="280" opacity=".5" />
					<!-- 通风栅格 -->
					<line x1="150" y1="292" x2="250" y2="292" opacity=".4" />
					<line x1="150" y1="300" x2="250" y2="300" opacity=".4" />
					<!-- 底座 -->
					<line x1="96" y1="320" x2="304" y2="320" />
					<!-- 参数标注 -->
					<text x="24" y="360" font-family="Saira, sans-serif" font-stretch="125%" font-size="11" letter-spacing="2" fill="currentColor" stroke="none">STELARITH / NODE 01</text>
					<text x="24" y="378" font-family="Saira, sans-serif" font-stretch="112%" font-size="10" letter-spacing="1" fill="currentColor" stroke="none" opacity=".6">16 CORE · 2,240 OPS · 99.9%</text>
				</svg>
			</div>
			<figcaption class="ex-plate">{s.heroTitle || "Stelarith"}</figcaption>
		</figure>

		{#if posts.length > 1}
			<div class="ex-ticker" aria-label="最近的文章">
				<div class="track">
					<ul>
						{#each posts.slice(0, 6) as post, i}
							<li><a href="/posts/{post.slug}"><b>No.{no(i)}</b>{post.title}</a></li>
						{/each}
					</ul>
					<ul aria-hidden="true">
						{#each posts.slice(0, 6) as post, i}
							<li><a href="/posts/{post.slug}" tabindex="-1"><b>No.{no(i)}</b>{post.title}</a></li>
						{/each}
					</ul>
				</div>
			</div>
		{/if}
	</section>

	<!-- ═══ 最新一篇（空心大编号，悬停落定）═══ -->
	{#if latest}
		<section class="latest">
			<a href="/posts/{latest.slug}" data-fx-host>
				<span class="ex-hollow-no" aria-hidden="true" data-fx>{no(0)}</span>
				<span class="body">
					<span class="ex-field"><span class="flag">最新</span> {latest.date}</span>
					<span class="title">{latest.title}</span>
					<span class="ex-read digests">{latest.excerpt}</span>
					<span class="ex-btn go">阅读全文</span>
				</span>
			</a>
		</section>
	{/if}

	<!-- ═══ 继续阅读 / 最近浏览 ═══ -->
	<ContinueReading />

	<!-- ═══ 文章索引（记录行）═══ -->
	<section class="index">
		<p class="ex-eyebrow slash">Index / Posts</p>
		<h2 class="ex-bar-title">全站文章</h2>
		{#if posts.length > 0}
			<ol class="ex-records">
				{#each posts as post, i}
					<li>
						<a class="ex-record ex-in-come" style="--i:{i}" href="/posts/{post.slug}">
							<span class="ex-tag">No.{no(i)}</span>
							<time class="ex-field">{post.date}</time>
							<span class="name ex-read">{post.title}</span>
						</a>
					</li>
				{/each}
			</ol>
		{:else}
			<p class="ex-empty">还没有发布文章。写好的笔记会按发布顺序编号，列在这里。</p>
		{/if}
	</section>

	<!-- ═══ 本站特性（编号记录行）═══ -->
	{#if features.length > 0}
		<section class="index">
			<p class="ex-eyebrow slash">Features</p>
			<h2 class="ex-bar-title">本站特性</h2>
			<ol class="ex-records">
				{#each features as f, i}
					<li>
						<div class="ex-record as-row">
							<span class="ex-tag">{String(i + 1).padStart(2, "0")}</span>
							<span class="name ex-read"><b>{f.title}</b><span class="desc">{f.description}</span></span>
						</div>
					</li>
				{/each}
			</ol>
		</section>
	{/if}

	<!-- ═══ 项目 / 教程（双栏记录行）═══ -->
	{#if projects.length > 0 || docs.length > 0}
		<section class="index duo">
			{#if projects.length > 0}
				<div>
					<p class="ex-eyebrow slash">Projects</p>
					<h2 class="ex-bar-title">项目</h2>
					<ol class="ex-records">
						{#each projects as p, i}
							<li><a class="ex-record" href="/projects/{p.slug}"><span class="ex-tag">{String(i + 1).padStart(2, "0")}</span><span class="name ex-read">{p.title}</span></a></li>
						{/each}
					</ol>
				</div>
			{/if}
			{#if docs.length > 0}
				<div>
					<p class="ex-eyebrow slash">Docs</p>
					<h2 class="ex-bar-title">教程</h2>
					<ol class="ex-records">
						{#each docs as d, i}
							<li><a class="ex-record" href="/docs/{d.slug}"><span class="ex-tag">{String(i + 1).padStart(2, "0")}</span><span class="name ex-read">{d.title}</span></a></li>
						{/each}
					</ol>
				</div>
			{/if}
		</section>
	{/if}

	<!-- ═══ 关注（键值行）═══ -->
	{#if socials.length > 0}
		<section class="index" id="social">
			<p class="ex-eyebrow slash">Follow</p>
			<h2 class="ex-bar-title">{s.socialTitle || "关注我"}</h2>
			<div class="socials">
				{#each socials as so}
					<a class="ex-kv" href={so.url} target="_blank" rel="noopener noreferrer"><span>{so.name}</span><span>↗</span></a>
				{/each}
			</div>
		</section>
	{/if}

	<!-- ═══ 页脚 ═══ -->
	<footer class="foot ex-field">
		<span>© {new Date().getFullYear()} {s.title || "Stelarith"}</span>
		<span>代码 · 校园 · 热爱</span>
	</footer>
</div>

<style>
	/* ── 页面布局（移植自终末地 showcase 模板）──
	   视觉全部来自 endfield-kit.css 的 .ex-* 变量与部件，这里只管版式。 */
	.hero {
		--mx: 0;
		--my: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 42%);
		grid-template-rows: auto 1fr auto auto;
		column-gap: clamp(1.5rem, 4vw, 3.5rem);
		min-height: min(40rem, calc(100dvh - 3px));
		padding-top: 1.25rem;
		border-bottom: 1px solid var(--ex-rule);
		overflow: hidden;
	}
	.hero > .meta {
		grid-column: 1;
		margin: 0;
		padding-inline: var(--ex-pad);
	}
	.hero > .meta > * + *::before {
		content: '/';
		margin-inline: 0.75em;
		color: var(--ex-rule);
	}
	.hero .ex-wordmark {
		/* 覆盖 kit 默认 clamp(3rem,10vw,11rem)：STELARITH 有 9 个字母，
		   kit 值在宽屏会把一个单词折断成 STELA/RITH。收紧到能一行放下。 */
		--ex-wordmark: clamp(2.2rem, 5.2vw, 5rem);
		grid-column: 1;
		align-self: end;
		margin-top: 2rem;
		padding-left: var(--ex-pad);
	}
	.hero .ex-wordmark > * { white-space: nowrap; }
	.hero .copy {
		grid-column: 1;
		padding: 1.75rem var(--ex-pad) 2.25rem;
	}
	.hero .copy p { margin: 0; }
	.hero .claim { font-size: clamp(1.15rem, 2.2vw, 1.6rem); }
	.hero .bio { max-width: 30rem; margin-top: 0.9rem; color: var(--ex-ink-2); }
	.hero .ex-actions { margin-top: 1.5rem; }
	.hero .ex-frame {
		grid-column: 2;
		grid-row: 1 / 4;
		margin: 0 var(--ex-pad) 2.25rem 0;
	}
	.hero .ex-frame::before {
		transform: translate(calc(var(--mx) * 12px), calc(var(--my) * 10px));
	}
	.hero .ex-frame svg {
		width: 100%;
		height: 100%;
		transform: translate(calc(var(--mx) * -14px), calc(var(--my) * -8px));
		transition: transform 0.4s var(--ex-ease);
	}
	.hero .ex-ticker { grid-column: 1 / -1; }

	.latest { background: var(--ex-panel); border-bottom: 1px solid var(--ex-rule); }
	.latest > a {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: center;
		gap: clamp(1.5rem, 5vw, 4rem);
		padding: clamp(1.75rem, 4vw, 3rem) var(--ex-pad);
	}
	.latest .body { display: flex; flex-direction: column; align-items: flex-start; gap: 0.9rem; max-width: 44rem; }
	.latest .title { font-size: clamp(1.6rem, 3.4vw, 2.6rem); font-weight: 800; line-height: 1.2; }
	.latest .flag { padding: 0.05em 0.6em; background: var(--ex-signal); color: var(--ex-on-signal); font-weight: 700; }
	.latest .digests { color: var(--ex-ink-2); line-height: 1.8; }

	.index { padding: clamp(2rem, 4vw, 3rem) var(--ex-pad) 3rem; }
	.index.duo { display: grid; gap: 2.5rem; }
	@media (min-width: 768px) { .index.duo { grid-template-columns: 1fr 1fr; gap: 3rem; } }
	.as-row { display: flex; gap: 1rem; align-items: baseline; }
	.as-row .desc { display: block; margin-top: 0.25rem; font-size: 0.9em; color: var(--ex-ink-2); }
	.socials { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-top: 1rem; }
	.foot {
		display: flex; flex-wrap: wrap; gap: 1rem; justify-content: space-between;
		padding: 1.5rem var(--ex-pad); border-top: 1px solid var(--ex-rule); color: var(--ex-ink-2);
	}

	@media (max-width: 899px) {
		.hero { grid-template-columns: minmax(0, 1fr); grid-template-rows: none; min-height: 0; }
		.hero .ex-frame { grid-column: 1; grid-row: auto; height: 18rem; margin: 0 calc(var(--ex-pad) + 1rem) 2.25rem var(--ex-pad); }
		.latest > a { grid-template-columns: minmax(0, 1fr); }
	}
</style>
