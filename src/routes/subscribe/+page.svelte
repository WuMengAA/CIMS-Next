<script lang="ts">
	import { page } from "$app/state";
	import PageHero from "$lib/components/page-hero.svelte";
	import { Card } from "$lib/components/ui/card/index.js";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Rss, Copy, Check, BellRing, MonitorSmartphone, BookOpen } from "@lucide/svelte";

	let copied = $state("");

	async function copy(text: string, key: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = key;
			setTimeout(() => (copied = ""), 1500);
		} catch {}
	}

	const settings = $derived((page.data as any)?.settings ?? {});
	const siteName = $derived(settings.title || "Stelarith");
	const base = $derived(typeof window !== "undefined" ? window.location.origin : "");
	const feeds = $derived([
		{ key: "blog", label: "博客 RSS", url: "/rss.xml", desc: "全部博客文章，随更新推送。" },
		{ key: "user", label: "个人订阅", url: "/u/stelarith/rss.xml", desc: "单个作者的公开动态。" }
	]);

	const steps = [
		{ icon: Rss, title: "复制订阅地址", desc: "点击上方卡片里的「复制」按钮，拿到订阅链接。" },
		{ icon: BellRing, title: "添加到阅读器", desc: "在任意 RSS 阅读器（如 Feedly、Inoreader、NetNewsWire）中「添加订阅源」，粘贴链接。" },
		{ icon: MonitorSmartphone, title: "随时随地阅读", desc: "新内容发布后会自动同步到你的阅读器，无需再来站内刷新。" }
	];

	const clients = ["Feedly", "Inoreader", "NetNewsWire", "Reeder", "Follow", "FreshRSS"];
</script>

<svelte:head>
	<title>订阅 | {siteName}</title>
</svelte:head>

<PageHero icon={Rss} title="订阅" desc={`关注 {siteName} 的最新内容，RSS 一劳永逸。`} />

<div class="mx-auto max-w-3xl space-y-6 px-4 py-8">
	<!-- 订阅源卡片 -->
	<div class="grid gap-3 sm:grid-cols-2">
		{#each feeds as f (f.key)}
			<Card class="p-4">
				<div class="flex items-center gap-2">
					<div class="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
						<f.icon class="size-4" />
					</div>
					<div class="min-w-0">
						<p class="text-sm font-medium">{f.label}</p>
						<p class="truncate text-xs text-muted-foreground">{f.desc}</p>
					</div>
				</div>
				<div class="mt-3 flex items-center gap-2">
					<code class="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/40 px-2 py-1 text-xs">{base}{f.url}</code>
					<Button variant="outline" size="sm" class="shrink-0 gap-1.5" onclick={() => copy(base + f.url, f.key)}>
						{#if copied === f.key}
							<Check class="size-4 text-primary" />已复制
						{:else}
							<Copy class="size-4" />复制
						{/if}
					</Button>
				</div>
			</Card>
		{/each}
	</div>

	<!-- 三步引导 -->
	<section class="rounded-xl border border-border/60 bg-card p-6">
		<h2 class="mb-4 flex items-center gap-2 font-heading text-lg font-medium">
			<BookOpen class="size-5 text-primary" />三步完成订阅
		</h2>
		<ol class="space-y-4">
			{#each steps as s, i (s.title)}
				<li class="flex items-start gap-3">
					<span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
						<s.icon class="size-4" />
					</span>
					<div>
						<p class="text-sm font-medium">{i + 1}. {s.title}</p>
						<p class="text-sm text-muted-foreground">{s.desc}</p>
					</div>
				</li>
			{/each}
		</ol>
	</section>

	<!-- 常用阅读器 -->
	<section class="rounded-xl border border-border/60 bg-card p-6">
		<h2 class="mb-3 font-heading text-lg font-medium">支持的阅读器</h2>
		<p class="mb-3 text-sm text-muted-foreground">RSS 是开放标准，任何支持 RSS 的客户端都可以订阅本站：</p>
		<div class="flex flex-wrap gap-2">
			{#each clients as c (c)}
				<span class="rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">{c}</span>
			{/each}
		</div>
	</section>
</div>
