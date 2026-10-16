<script lang="ts">
	import type { PageProps } from "./$types";
	import { Music2, ExternalLink, BookOpen } from "@lucide/svelte";
	import EmbedWeb from "$lib/components/embed-web.svelte";

	let { data }: PageProps = $props();
	const embedSrc = $derived(
		data.base && data.base !== "https://voicehub.245959623.xyz"
			? data.base
			: "https://voicehub.245959623.xyz"
	);

	// SEO 首选域名（用户指定）：canonical/OG 一律写死，避免多域名重复收录
	const SITE = "https://voicehub.245959623.xyz";
	const canon = `${SITE}/voicehub`;

	const appLd = {
		"@context": "https://schema.org",
		"@type": "WebApplication",
		"name": "校园点歌站",
		"url": canon,
		"applicationCategory": "EducationApplication",
		"operatingSystem": "Web",
		"about": "校园广播站点歌服务：同学在线点歌、广播站成员审核排单与播前检查。",
		"offers": { "@type": "Offer", "price": "0", "priceCurrency": "CNY" }
	};
</script>

<svelte:head>
	<title>校园点歌 | Stelarith</title>
	<meta name="description" content="校园广播站点歌服务：同学在线点歌、查看播放状态，广播站成员负责审核、排单与播前检查。内含使用帮助（同学须知 / 成员须知）。" />
	<meta name="robots" content="index, follow" />
	<link rel="canonical" href={canon} />
	<meta property="og:type" content="website" />
	<meta property="og:locale" content="zh_CN" />
	<meta property="og:title" content="校园点歌 | Stelarith" />
	<meta property="og:description" content="同学在线点歌、广播站成员审核排单；内含同学须知与成员须知。" />
	<meta property="og:url" content={canon} />
	<meta property="og:site_name" content="Stelarith" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="校园点歌 | Stelarith" />
	<meta name="twitter:description" content="同学在线点歌、广播站成员审核排单；内含同学须知与成员须知。" />
	{@html `<script type="application/ld+json">${JSON.stringify(appLd)}<\/script>`}
</svelte:head>

<div class="ef-shell ef-shell--wide flex flex-col gap-6 py-10">
	<header class="flex flex-col gap-2">
		<h1 class="flex items-center gap-2 font-heading text-3xl font-semibold tracking-tight">
			<Music2 class="size-7 text-primary" /> 校园点歌
		</h1>
		<p class="text-sm text-muted-foreground">内嵌 voicehub 校园点歌站 · 支持宽度调整与全屏打开</p>
		<div class="flex flex-wrap gap-3">
			<a
				href={embedSrc}
				target="_blank"
				rel="noopener"
				class="inline-flex w-fit items-center gap-1 text-sm text-primary hover:underline"
			>
				新窗口打开点歌站 <ExternalLink class="size-4" />
			</a>
			<a
				href="/voicehub/help"
				class="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-primary hover:underline"
			>
				使用帮助（同学 / 成员须知）<BookOpen class="size-4" />
			</a>
		</div>
	</header>

	<!-- 可抓取正文：给搜索引擎真实可读的内容（iframe 内嵌的第三方点歌站不会被计入本页） -->
	<section class="rounded-xl border border-border bg-card/40 p-5 text-sm leading-relaxed text-muted-foreground">
		<p>
			<b class="text-foreground">校园点歌</b> 是面向全校同学与广播站成员的广播站点歌服务。
			同学可以在开放时间内提交点歌请求（歌名、歌手、想说的话、点给谁），并在"我的点歌"中查看
			<b class="text-foreground">待审核 → 已通过 → 已播放</b> 的状态；广播站成员负责审核、排单与播前检查，
			确认歌名、音源、版权、敏感词、音量与时段后安排播出。
		</p>
		<p class="mt-2">
			所有点歌内容需符合规范：不播违规、低俗、侵权、攻击性歌曲，不泄露同学隐私；审核与播放由广播站 / 第三方负责，校方负责监管。
			使用方式与成员操作维护说明见 <a href="/voicehub/help" class="text-primary hover:underline">使用帮助</a>。
		</p>
	</section>

	{#if !data.configured}
		<div class="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
			点歌站尚未接入（未配置 VOICEHUB_BASE / VOICEHUB_KEY）。<br />
			在 .env 配置后即可内嵌展示。
		</div>
	{:else if data.error}
		<div class="rounded-xl border border-red-500/40 bg-red-500/10 p-8 text-center text-sm">
			<p class="font-medium text-red-300">已配置 Voicehub，但连接失败</p>
			<p class="mt-2 text-muted-foreground">
				HTTP 状态：{data.errorStatus ?? "未知（网络异常）"}。<br />
				请检查 VOICEHUB_KEY 是否有效、是否具备 <code class="rounded bg-black/30 px-1">songs:read</code> 权限，且 VOICEHUB_BASE 指向正确的实例。
			</p>
		</div>
	{:else}
		<EmbedWeb src={embedSrc} title="voicehub 校园点歌站" height={760} />
	{/if}
</div>
