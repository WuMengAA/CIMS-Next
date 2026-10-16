		<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import { Heart, Send, MessageCircle, Rocket, Globe } from "@lucide/svelte";
	import { Github, Twitter } from "$lib/components/icons/index.js";
	import CountUp from "$lib/components/count-up.svelte";
	import ContinueReading from "$lib/components/continue-reading.svelte";
	import { resolveFeatureIcon } from "$lib/feature-icons.js";
	import { reveal } from "$lib/actions/reveal.js";
import { splitReveal } from "$lib/actions/split-reveal.js";
	import { page } from "$app/state";
	import type { PageProps } from "./$types";
	import Seo from "$lib/components/Seo.svelte";

	let { data }: PageProps = $props();

	const iconMap: Record<string, any> = {
		"github": Github, "twitter": Twitter, "x": Twitter,
		"爱发电": Heart, "ifdian": Heart, "heart": Heart,
		"哔哩哔哩": Send, "bilibili": Send, "b站": Send,
		"qq": MessageCircle, "qq群": MessageCircle, "telegram": Send, "tg": Send
	};
	const socials = $derived(
		(data.settings.socials || []).map((s) => ({ ...s, icon: iconMap[s.name.toLowerCase()] || iconMap[s.name] || Globe }))
	);
	const features = $derived(data.settings.features || []);
</script>

<Seo
	title="首页"
	description={data.settings.description || data.settings.heroTitle || "Stelarith"}
	path="/"
	jsonLd={[
		{
			"@context": "https://schema.org",
			"@type": "WebSite",
			name: data.settings.title || "Stelarith",
			description: data.settings.description || "",
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
			name: data.settings.title || "Stelarith",
			url: data.siteUrl || "",
			logo: `${data.siteUrl || ""}/avatars/default.svg`
		}
	]}
/>

<div class="ef-shell flex flex-col py-12 md:py-20">
	<!-- Hero：杂志编辑式（左对齐、Fraunces 超大标题、pill CTA） -->
	<section class="parallax-hero flex flex-col items-start gap-6">
		<div use:reveal class="reveal ef-label" style="--reveal-delay:0"><Rocket class="size-3.5 text-primary" />{data.settings.heroBadge}</div>
		<h1 use:reveal class="reveal ef-hero-title font-heading" style="--reveal-delay:1">
			<span use:splitReveal step={46} start={260}>Stelarith</span>
			<span class="mt-3 block text-xl font-normal text-muted-foreground md:text-2xl">{data.settings.heroTitle}</span>
		</h1>
		<p use:reveal class="reveal max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg" style="--reveal-delay:2">{data.settings.heroSubtitle}</p>
		<div use:reveal class="reveal mt-2 flex flex-wrap items-center gap-3" style="--reveal-delay:3">
			<Button href="#social" class="ef-cta btn-glow btn-shine">关注我</Button>
			<Button href="/changelog" variant="secondary" class="ef-cta btn-shine">看看最近更新</Button>
		</div>
	</section>

	<!-- 跑马灯：品牌关键词流动（编辑流体特征） -->
	<div use:reveal class="reveal ef-marquee mt-14" style="--reveal-delay:0">
		<div class="ef-marquee-track font-heading text-[11px] uppercase tracking-[0.24em] text-muted-foreground/70">
			{#each [0, 1] as _}
				<span>
					<span>代码</span><span class="text-primary">✦</span>
					<span>校园</span><span class="text-primary">✦</span>
					<span>热爱</span><span class="text-primary">✦</span>
					<span>Stelarith</span><span class="text-primary">✦</span>
					<span>编辑流体</span><span class="text-primary">✦</span>
				</span>
			{/each}
		</div>
	</div>

	<!-- 继续阅读 / 最近浏览（首访不渲染，回访直接续读） -->
	<ContinueReading />

	<!-- 品牌声明：杂志引用式（双向夹击遮罩 + 描绘线） -->
	<section class="flex flex-col items-start gap-3 pt-20">
		<div use:reveal class="reveal ef-label" style="--reveal-delay:0">关于本站</div>
		<p use:reveal class="reveal-clamp font-heading text-2xl leading-snug md:text-3xl" style="--reveal-delay:1">{data.settings.slogan}</p>
		<span use:reveal class="reveal ef-draw mt-2" style="--reveal-delay:2"></span>
	</section>

	<!-- 统计栏：杂志大数字（保留 CountUp 滚动） -->
	<section use:reveal class="reveal mt-16 grid gap-4 md:grid-cols-3" style="--reveal-delay:2">
		<div class="ef-stat-card">
			<span class="ef-stat-line"></span>
			<div class="ef-big-num text-primary"><CountUp value={(data.posts || []).length} duration={1000} /></div>
			<div class="ef-label">篇文章</div>
			<span class="ef-stat-sub">文字的重量</span>
		</div>
		<div class="ef-stat-card">
			<span class="ef-stat-line"></span>
			<div class="ef-big-num text-primary"><CountUp value={(data.projects || []).length} duration={1100} /></div>
			<div class="ef-label">个项目</div>
			<span class="ef-stat-sub">想法的落地</span>
		</div>
		<div class="ef-stat-card">
			<span class="ef-stat-line"></span>
			<div class="ef-big-num text-primary"><CountUp value={(data.docs || []).length} duration={1200} /></div>
			<div class="ef-label">篇教程</div>
			<span class="ef-stat-sub">知识的传递</span>
		</div>
	</section>

	<!-- 特性：编号排版（01/02/03，无框 hairline 行 · 逐行横向揭开） -->
	<section class="parallax-slow mt-20">
		<div use:reveal class="reveal ef-label" style="--reveal-delay:0">本站特性</div>
		<span use:reveal class="reveal ef-draw mt-3" style="--reveal-delay:1"></span>
		<div class="mt-6 flex flex-col divide-y divide-border/40">
			{#each features as f, i (f.title)}
				{@const FeatureIcon = resolveFeatureIcon(f.icon)}
				<div use:reveal class="reveal-wipe ef-feature group grid gap-2 py-6 md:grid-cols-[2.75rem_1fr] md:items-baseline" style:--reveal-delay={i + 2}>
					<span class="ef-num">{String(i + 1).padStart(2, "0")}</span>
					<div>
						<h2 class="font-heading text-xl transition-colors group-hover:text-primary md:text-2xl">
							<FeatureIcon class="mr-2 inline size-4 text-primary" />
							{f.title}
						</h2>
						<p class="mt-1 text-sm leading-relaxed text-muted-foreground">{f.description}</p>
					</div>
				</div>
			{/each}
		</div>
	</section>

	<!-- 最新内容：杂志列表（日期编号 + 衬线标题 + hairline） -->
	<section use:reveal class="reveal parallax-mid mt-16" style="--reveal-delay:0">
		<div class="flex items-baseline justify-between">
			<h2 class="ef-label">最新内容</h2>
			<a href="/changelog" class="text-sm text-muted-foreground transition-colors hover:text-primary">查看全部 →</a>
		</div>

		{#if data.posts.length > 0}
			<div class="mt-4 flex flex-col">
				{#each data.posts as post (post.slug)}
					<a href="/posts/{post.slug}" class="ef-list-row group">
						<span class="ef-num shrink-0">{post.date}</span>
						<div class="min-w-0 flex-1">
							<h3 class="truncate font-heading text-lg transition-colors group-hover:text-primary">{post.title}</h3>
							<p class="line-clamp-1 text-xs text-muted-foreground">{post.excerpt}</p>
						</div>
						<span class="shrink-0 text-muted-foreground opacity-0 transition-opacity duration-300 group-hover:opacity-100">→</span>
					</a>
				{/each}
			</div>
		{/if}

		{#if data.projects.length > 0 || data.docs.length > 0}
			<div class="mt-10 grid gap-x-10 md:grid-cols-2">
				{#if data.projects.length > 0}
					<div>
						<h3 class="ef-label">项目</h3>
						<div class="mt-2 flex flex-col">
							{#each data.projects as project (project.slug)}
								<a href="/projects/{project.slug}" class="ef-list-row group">
									<span class="min-w-0 flex-1 truncate font-heading text-sm transition-colors group-hover:text-primary">{project.title}</span>
									<span class="shrink-0 text-muted-foreground opacity-0 transition-opacity duration-300 group-hover:opacity-100">→</span>
								</a>
							{/each}
						</div>
					</div>
				{/if}
				{#if data.docs.length > 0}
					<div>
						<h3 class="ef-label">教程</h3>
						<div class="mt-2 flex flex-col">
							{#each data.docs as doc (doc.slug)}
								<a href="/docs/{doc.slug}" class="ef-list-row group">
									<span class="min-w-0 flex-1 truncate font-heading text-sm transition-colors group-hover:text-primary">{doc.title}</span>
									<span class="shrink-0 text-muted-foreground opacity-0 transition-opacity duration-300 group-hover:opacity-100">→</span>
								</a>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</section>

	<!-- 社交：pill 行 -->
	<section id="social" use:reveal class="reveal mt-16 flex flex-col items-start gap-4" style="--reveal-delay:0">
		<h2 class="ef-label">{data.settings.socialTitle}</h2>
		<div class="flex flex-wrap items-center gap-2">
			{#each socials as s (s.name)}
				<a
					href={s.url}
					target="_blank"
					rel="noopener noreferrer"
					class="ef-cta flex h-10 items-center gap-2 border border-border/60 bg-card px-4 text-sm text-foreground transition-colors hover:border-primary/40 hover:text-primary"
				>
					<s.icon class="size-4" />
					{s.name}
				</a>
			{/each}
		</div>
	</section>
	<div class="mt-16 border-t border-border/40 pt-6">
		<div class="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
			<span>© {new Date().getFullYear()} Stelarith</span>
			<span class="ef-label">代码 · 校园 · 热爱</span>
		</div>
	</div>
</div>
