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
	import { afterNavigate } from "$app/navigation";
	import { navigating } from "$app/stores";
	import { page } from "$app/state";
	import { fade } from "svelte/transition";
	import { enableViewTransitions, pageIn } from "$lib/transition.js";
	import { replayReveals } from "$lib/actions/reveal.js";
	import { onMount } from "svelte";
	import Container from "$lib/components/container.svelte";
	import ContentSkeleton from "$lib/components/content-skeleton.svelte";
	import PresenceHeartbeat from "$lib/components/presence-heartbeat.svelte";
	import SidebarAutoClose from "$lib/components/sidebar-auto-close.svelte";
	import type { LayoutProps } from "./$types";

	// 用 SvelteKit 生成的 LayoutProps（含 data.user / data.canEdit），
	// 不要手写内联结构体类型——手写的会随服务端 load 演进而漂移，
	// 且因构建不做类型检查而静默失效（曾漏掉 data.user，导致在线心跳永不挂载）。
	let { children, data }: LayoutProps = $props();
	// 页面过渡：接管客户端导航为原生 View Transition（不支持则自动降级为轻量淡入）。
	enableViewTransitions();

	// 后台区自带侧边栏 / 顶栏，前台外壳需让位（见模板注释）：
	// 否则 /admin 会同时渲染前台侧栏与后台侧栏，两列导航并列。
	const isAdmin = $derived(page.url.pathname.startsWith("/admin"));

	// 路由切换：仅重放内容区 reveal 分段动画。
	// 必须在 afterNavigate（新页面 DOM 挂载完成后）重放，而非 onNavigate——
	// onNavigate 在换页前执行，querySelector 命中的是即将销毁的旧页面节点，
	// 导致新页面（尤其首页这种只靠全局 replay 解锁的 .reveal 区块）停在 opacity:0，
	// 需再点一次才偶然显形（"点两下才刷新"）。afterNavigate 命中新节点，一次到位。
	// 首屏仍靠下方 onMount 兜底（afterNavigate 不触发于初始直访）。

	// 供下方 live region 使用的页面标题播报文本（读屏专用）
	let announced = $state("");

	afterNavigate(() => {
		try { replayReveals(); } catch { /* noop */ }
		// 读屏播报：客户端导航是「无刷新换页」，读屏不会自动感知。
		// 用 live region 在其后播报新页面标题；视觉用户完全无感。
		setTimeout(() => { announced = document.title; }, 60);
	});

	// 首屏兜底：SSR 直访时 reveal 元素初始 opacity:0（CSS 写死，仅 JS 解锁），
	// 但 hydration 后 use:reveal 的 setTimeout 在后台标签页/时序问题下常未及时跑，
	// 导致首屏内容卡在隐藏态，需用户点一次导航触发 replayReveals 才显形。
	// 这里在 hydration 完成后立即重放一次，确保首屏无需点击即自动浮现。
	onMount(() => {
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

	<!-- 登录态在线心跳（多用户在线判定） -->
	{#if data.user}
		<PresenceHeartbeat />
	{/if}

	<!-- 阅读进度条 -->
	<div id="reading-progress" class="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 origin-left scale-x-0 bg-gradient-to-r from-primary via-primary/70 to-primary/40 transition-transform duration-100 ease-out" aria-hidden="true"></div>

	<!-- 导航加载进度条：客户端导航进行中显示，完成后淡出 -->
	{#if $navigating}
		<div transition:fade={{ duration: 150 }} class="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden" aria-hidden="true">
			<div class="nav-bar h-full w-1/3 bg-primary"></div>
		</div>
	{/if}

<!-- 键盘可达：首个 Tab 直达主内容，跳过侧边栏 + 顶栏 -->
<a href="#main-content" class="skip-link">跳到主内容</a>

<!-- 客户端导航后播报新页面标题（仅读屏可闻） -->
<div class="sr-only" role="status" aria-live="polite">{announced}</div>

<Sidebar.Provider>
	<!-- 移动端抽屉：导航后自动收起（必须在 Provider 内才能拿到 sidebar context） -->
	<SidebarAutoClose />

	<!-- 后台自带一套侧边栏与顶栏；此处不能再叠加前台外壳，
	     否则 /admin 会出现「站点侧栏 + 后台侧栏」两列导航（实测 data-slot="sidebar" 出现两次），
	     既挤压内容区也让导航语义混乱。 -->
	{#if !isAdmin}
		<AppSidebar data={data} />
	{/if}
	<Sidebar.Inset>
		{#if !isAdmin}
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
		{/if}
		{#if showSkeleton}
			<Container><ContentSkeleton /></Container>
		{:else}
			<!-- 页面过渡：{#key} 让不支持的浏览器也能重放入场淡入；
			     支持 View Transitions 时 pageIn 返回空配置，避免与原生过渡叠加。
			     后台路由把命名权让给 admin 布局（name: none），防止两层同时动画。 -->
			{#key page.url.pathname}
				<div
					id="main-content"
					tabindex="-1"
					in:pageIn
					style="view-transition-name: {page.url.pathname.startsWith('/admin') ? 'none' : 'page-content'}"
				>
					{@render children()}
				</div>
			{/key}
		{/if}
	</Sidebar.Inset>
</Sidebar.Provider>