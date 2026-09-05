<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import {
		Heart,
		Send,
		MessageCircle,
		Rocket,
		FileCode2,
		Palette,
		ShieldCheck,
		Globe
	} from "@lucide/svelte";
	import { Github, Twitter } from "$lib/components/icons/index.js";
	import CountUp from "$lib/components/count-up.svelte";
	import { page } from "$app/state";

	let { data }: { data: { settings: { title: string; description: string; siteName: string; slogan: string; heroTitle: string; heroSubtitle: string; heroBadge: string; features: { title: string; description: string }[]; socialTitle: string; footer: string; socials: { name: string; url: string }[] }; posts: any[]; projects: any[]; docs: any[] } } = $props();

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

<svelte:head>
	<title>首页 | Stelarith</title>
</svelte:head>

<div class="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-16 px-4 py-12 md:px-8 md:py-16">
	<!-- Hero -->
	<section class="reveal parallax-hero flex flex-col items-center gap-8 text-center" style="--reveal-delay:0">
		<Badge variant="secondary" class="gap-1.5 rounded-full px-3 py-1">
			<Rocket class="size-3.5 text-primary" />
			{data.settings.heroBadge}
		</Badge>
		<h1 class="text-shimmer font-heading text-5xl font-semibold tracking-tight md:text-6xl">
			Stelarith
			<span class="block text-2xl font-normal text-muted-foreground md:text-3xl">
				{data.settings.heroTitle}
			</span>
		</h1>
		<p class="max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
			{data.settings.heroSubtitle}
		</p>
		<div class="flex items-center gap-3">
			<Button asChild class="btn-glow btn-shine">
				<a href="#social">关注我</a>
			</Button>
			<Button asChild variant="secondary" class="btn-shine">
				<a href="/posts">开始阅读</a>
			</Button>
		</div>
	</section>

	<!-- Brand statement -->
	<section class="reveal flex flex-col items-center gap-4 text-center" style="--reveal-delay:1">
		<div
			class="flex size-16 items-center justify-center rounded-2xl bg-primary font-heading text-2xl font-bold text-primary-foreground"
		>
			AF
		</div>
		<p class="font-heading text-xl md:text-2xl">{data.settings.slogan}</p>
	</section>

	<!-- Features -->
	<section class="reveal parallax-slow grid gap-4 md:grid-cols-3" style="--reveal-delay:2">
		{#each features as f (f.title)}
			<div
				class="card-hover group flex flex-col gap-4 rounded-xl border border-border/60 bg-card p-6"
			>
				<div
					class="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary"
				>
					<f.icon class="size-5" />
				</div>
				<h2 class="font-heading text-lg font-medium">{f.title}</h2>
				<p class="text-sm leading-relaxed text-muted-foreground">{f.description}</p>
			</div>
		{/each}
	</section>


	<!-- 统计栏：滚动计数动画（React Bits 风格） -->
	<section class="reveal flex flex-wrap items-stretch justify-center gap-4" style="--reveal-delay:4">
		<div class="min-w-28 flex-1 rounded-xl border border-border/60 bg-card/60 p-5 text-center">
			<div class="font-heading text-3xl font-semibold text-primary"><CountUp value={(data.posts || []).length} duration={1000} /></div>
			<div class="mt-1 text-xs text-muted-foreground">篇文章</div>
		</div>
		<div class="min-w-28 flex-1 rounded-xl border border-border/60 bg-card/60 p-5 text-center">
			<div class="font-heading text-3xl font-semibold text-primary"><CountUp value={(data.projects || []).length} duration={1100} /></div>
			<div class="mt-1 text-xs text-muted-foreground">个项目</div>
		</div>
		<div class="min-w-28 flex-1 rounded-xl border border-border/60 bg-card/60 p-5 text-center">
			<div class="font-heading text-3xl font-semibold text-primary"><CountUp value={(data.docs || []).length} duration={1200} /></div>
			<div class="mt-1 text-xs text-muted-foreground">篇文档</div>
		</div>
	</section>
	<!-- Recent content -->
	<section class="reveal parallax-mid flex flex-col gap-8" style="--reveal-delay:3">
		<div class="flex items-center justify-between">
			<h2 class="font-heading text-xl">最新内容</h2>
			<a href="/posts" class="text-sm text-muted-foreground hover:text-primary">查看全部 →</a>
		</div>

		{#if data.posts.length > 0}
			<div class="flex flex-col divide-y divide-border/40 rounded-xl border border-border/60 bg-card">
				{#each data.posts as post (post.slug)}
					<a href="/posts/{post.slug}" class="group flex items-center gap-3 p-4 transition-colors hover:bg-accent/40">
						<div class="min-w-0 flex-1">
							<h3 class="truncate font-medium group-hover:text-primary">{post.title}</h3>
							<p class="line-clamp-1 text-xs text-muted-foreground">{post.excerpt}</p>
						</div>
						<span class="shrink-0 text-xs text-muted-foreground">{post.date}</span>
					</a>
				{/each}
			</div>
		{/if}

		{#if data.projects.length > 0 || data.docs.length > 0}
			<div class="grid gap-4 sm:grid-cols-2">
				{#if data.projects.length > 0}
					<div class="rounded-xl border border-border/60 bg-card p-5">
						<h3 class="mb-3 font-heading font-medium">项目</h3>
						<div class="flex flex-col gap-2">
							{#each data.projects as project (project.slug)}
								<a href="/projects/{project.slug}" class="group text-sm">
									<span class="truncate group-hover:text-primary">{project.title}</span>
								</a>
							{/each}
						</div>
					</div>
				{/if}
				{#if data.docs.length > 0}
					<div class="rounded-xl border border-border/60 bg-card p-5">
						<h3 class="mb-3 font-heading font-medium">文档</h3>
						<div class="flex flex-col gap-2">
							{#each data.docs as doc (doc.slug)}
								<a href="/docs/{doc.slug}" class="group text-sm">
									<span class="truncate group-hover:text-primary">{doc.title}</span>
								</a>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</section>
	<!-- Social -->
	<section id="social" class="reveal flex flex-col items-center gap-4 text-center" style="--reveal-delay:4">
		<h2 class="font-heading text-xl">{data.settings.socialTitle}</h2>
		<div class="flex flex-wrap items-center justify-center gap-2">
			{#each socials as s (s.name)}
				<a
					href={s.url}
					target="_blank"
					rel="noopener noreferrer"
					class="flex h-10 items-center gap-2 rounded-lg border border-border/60 bg-card px-4 text-sm text-foreground transition-colors hover:border-primary/40 hover:text-primary"
				>
					<s.icon class="size-4" />
					{s.name}
				</a>
			{/each}
		</div>
	</section>
</div>