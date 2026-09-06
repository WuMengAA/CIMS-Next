<script lang="ts">
	import "./layout.css";
	import "highlight.js/styles/github-dark.css";
	import "katex/dist/katex.min.css";
	import "@fontsource-variable/inter";
	import "@fontsource-variable/lora";
	import * as Sidebar from "$lib/components/ui/sidebar/index.js";
	import { Separator } from "$lib/components/ui/separator/index.js";
	import { Toaster } from "$lib/components/ui/sonner/index.js";
	import { PanelLeft } from "@lucide/svelte";
	import AppSidebar from "$lib/components/app-sidebar.svelte";
	import BgEffects from "$lib/components/bg-effects.svelte";
	import AnnouncementBanner from "$lib/components/announcement-banner.svelte";
	import favicon from "$lib/assets/favicon.svg";
	import { onNavigate } from "$app/navigation";
	import { navigating } from "$app/stores";
	import { fade } from "svelte/transition";
	import { replayReveals } from "$lib/actions/reveal.js";
	import Container from "$lib/components/container.svelte";
	import ContentSkeleton from "$lib/components/content-skeleton.svelte";

	let { children, data }: { children: Snippet; data: { settings: { title: string; description: string; siteName: string; slogan: string; socials: { name: string; url: string }[] }; nav: { workspace: { title: string; url: string; icon?: string }[]; more: { title: string; url: string; icon?: string }[]; bottom: { title: string; url: string; icon?: string }[] }; siteUrl: string } } = $props();
	// 路由切换：仅重放内容区 reveal 分段动画。
	// 不用全局 view-transition：它对整页 root 拍照过渡，侧边栏也跟着淡入，
	// 观感是"每切一页整个界面重新加载一遍"。
	onNavigate(() => {
		try { replayReveals(); } catch { /* noop */ }
	});

	// 客户端导航骨架屏：navigating 为真时启动 200ms 阈值定时器，
	// 仅在导航耗时超过阈值（慢加载）才显示骨架，避免快速切换时不必要的闪烁；
	// 导航完成（navigating 变空）即清除骨架，新内容以淡入呈现。
	let showSkeleton = $state(false);
	let navTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		if ($navigating) {
			navTimer = setTimeout(() => { showSkeleton = true; }, 200);
		} else {
			if (navTimer) clearTimeout(navTimer);
			showSkeleton = false;
		}
	});
	// 阅读进度条：滚动即更新
	$effect(() => {
		const bar = document.getElementById("reading-progress") as HTMLDivElement | null;
		if (!bar) return;
		const update = () => {
			const doc = document.documentElement;
			const max = doc.scrollHeight - doc.clientHeight;
			const pct = max > 0 ? Math.min(1, window.scrollY / max) : 0;
			bar.style.transform = "scaleX(" + pct + ")";
		};
		window.addEventListener("scroll", update, { passive: true });
		window.addEventListener("resize", update);
		update();
		return () => { window.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="description" content={data.settings.description} />
	<meta name="color-scheme" content="dark" />
	<meta name="theme-color" content="#1b1b19" />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content={data.settings.title} />
	<meta property="og:title" content={data.settings.title} />
	<meta property="og:description" content={data.settings.description} />
	<meta property="og:url" content={data.siteUrl || "/"} />
	<link rel="canonical" href={data.siteUrl || "/"} />
	<meta name="twitter:card" content="summary_large_image" />
	<link rel="alternate" type="application/rss+xml" title={data.settings.title + " · 博客 RSS"} href="/rss.xml" />
</svelte:head>

	<!-- 全局动画背景 -->
	<BgEffects config={(data as any).settings?.background} />

	<!-- 全局通知 toast -->
	<Toaster richColors position="top-center" />

	<!-- 阅读进度条 -->
	<div id="reading-progress" class="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 origin-left scale-x-0 bg-gradient-to-r from-primary via-primary/70 to-primary/40 transition-transform duration-100 ease-out" aria-hidden="true"></div>

	<!-- 导航加载进度条：客户端导航进行中显示，完成后淡出 -->
	{#if $navigating}
		<div transition:fade={{ duration: 150 }} class="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden" aria-hidden="true">
			<div class="nav-bar h-full w-1/3 bg-primary"></div>
		</div>
	{/if}

<Sidebar.Provider>
	<AppSidebar data={data} />
	<Sidebar.Inset>
		<header
			class="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3 md:px-4"
		>
			<Sidebar.Trigger class="size-11 md:size-9">
				<PanelLeft class="size-4" />
				<span class="sr-only">Toggle Sidebar</span>
			</Sidebar.Trigger>
			<Separator orientation="vertical" class="h-4" />
			<span class="text-sm text-muted-foreground">{data.settings.title}</span>
		</header>
		<AnnouncementBanner />
		{#if showSkeleton}
			<Container><ContentSkeleton /></Container>
		{:else}
			<div in:fade={{ duration: 120 }}>
				{@render children()}
			</div>
		{/if}
	</Sidebar.Inset>
</Sidebar.Provider>