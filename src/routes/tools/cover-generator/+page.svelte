<script lang="ts">
	import PageHero from "$lib/components/page-hero.svelte";
	import { Image as ImageIcon, Download, Palette } from "@lucide/svelte";
	import { buildCoverSvg, RATIOS } from "$lib/cover.mjs";
	import { COVER_ICONS, COVER_ICON_NAMES } from "$lib/cover-icons.mjs";

	let title = $state("本地音乐播放器的架构选型");
	let subtitle = $state("为什么是 Flutter + Riverpod");
	let category = $state("工程笔记");
	let icon = $state("layers");
	let ratio = $state("16:9");
	let accent = $state("#cc785c");
	let bg = $state("#1b1b19");
	let bg2 = $state("#141413");

	const svg = $derived(
		buildCoverSvg({ title, subtitle, category, icon, ratio, accent, bg, bg2 })
	);
	const dims = $derived(RATIOS[ratio] || RATIOS["16:9"]);

	function iconSvg(name: string, size = 22) {
		return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${COVER_ICONS[name]}</svg>`;
	}

	function downloadBlob(blob: Blob, name: string) {
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = name;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	}

	function downloadSvg() {
		const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
		const safe = (title || "cover").replace(/[^\w一-龥-]+/g, "_").slice(0, 40);
		downloadBlob(blob, `cover-${safe}.svg`);
	}

	function downloadPng() {
		const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const img = new Image();
		img.onload = () => {
			const canvas = document.createElement("canvas");
			canvas.width = dims[0];
			canvas.height = dims[1];
			const ctx = canvas.getContext("2d");
			ctx.drawImage(img, 0, 0);
			URL.revokeObjectURL(url);
			canvas.toBlob((b) => {
				if (b) {
					const safe = (title || "cover").replace(/[^\w一-龥-]+/g, "_").slice(0, 40);
					downloadBlob(b, `cover-${safe}.png`);
				}
			}, "image/png");
		};
		img.onerror = () => URL.revokeObjectURL(url);
		img.src = url;
	}
</script>

<svelte:head>
	<title>封面生成器 | Stelarith</title>
</svelte:head>

<PageHero icon={Palette} title="封面生成器" desc="确定性模板封面：深色品牌底 + 陶土橙强调 + lucide 图标。实时预览，可导出 SVG（矢量）或 PNG（位图，适合 og:image）。" />

<div class="grid gap-6 lg:grid-cols-[1fr_360px]">
	<!-- 预览台：**刻意固定深色**，不跟随主题。
	     这里展示的就是深色品牌封面的成品效果，底色若跟着主题变亮，
	     预览与真实导出图就不一致了。所以用固定深色底，配白系文字，
	     两种主题下都读得清。 -->
	<div class="rounded-2xl border border-border bg-[#141413] p-4">
		<div class="mx-auto max-w-3xl overflow-hidden rounded-xl shadow-2xl ring-1 ring-white/10">
			{@html svg}
		</div>
		<div class="mt-4 flex flex-wrap gap-3">
			<button class="btn-primary" onclick={downloadSvg}>下载 SVG</button>
			<button class="btn-ghost" onclick={downloadPng}>下载 PNG（栅格）</button>
			<span class="ml-auto self-center text-sm text-white/50">{dims[0]}×{dims[1]} · {ratio}</span>
		</div>
	</div>

	<!-- 控制 -->
	<!-- 控制面板贴在页面底色上，原先写死 border-white/10 bg-black/20 ——
	     亮色主题下会退化成浅灰卡片，里面的白字全部看不见。改为语义令牌。 -->
	<div class="space-y-5 rounded-2xl border border-border bg-card p-5">
		<label class="block">
			<span class="label">标题</span>
			<input class="field" bind:value={title} placeholder="文章标题" />
		</label>
		<label class="block">
			<span class="label">副标题</span>
			<input class="field" bind:value={subtitle} placeholder="一句话摘要（可选）" />
		</label>
		<label class="block">
			<span class="label">分类 / 角标</span>
			<input class="field" bind:value={category} placeholder="如 工程笔记" />
		</label>

		<div>
			<span class="label">图标</span>
			<div class="mt-2 grid grid-cols-6 gap-2">
				{#each COVER_ICON_NAMES as name}
					<button
						class="grid h-10 place-items-center rounded-lg border text-muted-foreground transition {icon === name
							? 'border-primary bg-primary/15 text-primary'
							: 'border-border bg-muted hover:border-primary/40'}"
						title={name}
						onclick={() => (icon = name)}
					>
						{@html iconSvg(name, 20)}
					</button>
				{/each}
			</div>
		</div>

		<label class="block">
			<span class="label">画板比例</span>
			<select class="field" bind:value={ratio}>
				<option value="16:9">16:9（文章 / og:image）</option>
				<option value="4:3">4:3</option>
				<option value="1:1">1:1</option>
				<option value="21:9">21:9（横幅）</option>
			</select>
		</label>

		<div class="grid grid-cols-3 gap-3">
			<label class="block">
				<span class="label">强调色</span>
				<input type="color" class="swatch" bind:value={accent} />
			</label>
			<label class="block">
				<span class="label">底色 A</span>
				<input type="color" class="swatch" bind:value={bg} />
			</label>
			<label class="block">
				<span class="label">底色 B</span>
				<input type="color" class="swatch" bind:value={bg2} />
			</label>
		</div>

		<p class="text-xs leading-relaxed text-muted-foreground">
			提示：全站 10 篇文章的封面已用本工具风格批量生成（<code>scripts/gen-covers.mjs</code>），位于
			<code>static/covers/</code>。需要重新生成时改脚本里的图标映射后运行即可。
		</p>
	</div>
</div>

<style>
	/* .label / .field / .swatch 只出现在控制面板（跟随主题）里，
	   原先写死白系 rgba —— 亮色下等于隐形。改用令牌。
	   注意 .btn-primary 原来用的是 var(--accent)：那是**面/背景色**令牌，
	   不是品牌色，渲染出来是一枚灰按钮；而且硬编码了深色文字。
	   改回 --primary / --primary-foreground。 */
	.label {
		display: block;
		margin-bottom: 6px;
		font-size: 13px;
		color: var(--muted-foreground);
	}
	.field {
		width: 100%;
		border-radius: 10px;
		border: 1px solid var(--input);
		background: var(--background);
		padding: 9px 11px;
		color: var(--foreground);
		font-size: 14px;
		outline: none;
	}
	.field:focus {
		border-color: var(--ring);
	}
	.swatch {
		width: 100%;
		height: 38px;
		border-radius: 10px;
		border: 1px solid var(--input);
		background: transparent;
		cursor: pointer;
	}
	.btn-primary {
		border-radius: 10px;
		background: var(--primary);
		color: var(--primary-foreground);
		font-weight: 600;
		padding: 9px 16px;
		font-size: 14px;
	}
	.btn-ghost {
		border-radius: 10px;
		border: 1px solid rgba(255, 255, 255, 0.16);
		color: #f5f3ef;
		padding: 9px 16px;
		font-size: 14px;
	}
	.btn-ghost:hover {
		border-color: rgba(255, 255, 255, 0.4);
	}
</style>
