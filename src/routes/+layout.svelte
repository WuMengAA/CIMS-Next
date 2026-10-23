<script lang="ts">
	// 样式加载顺序：第三方在前、本站 layout.css 压轴 —— 让本站令牌与覆盖
	// （尤其 `.dark .hljs` 这份代码高亮深色改写）稳落在最后。
	// 双主题下只 import 亮色的 highlight 主题，深色见 layout.css 末尾。
	import "katex/dist/katex.min.css";
	// Inter/Lora 已下线（全站 Saira + Noto Sans SC 走 jsDelivr CDN，见 <svelte:head> 的 <link>）
	import "highlight.js/styles/github.css";
	import "./layout.css";
	import * as Sidebar from "$lib/components/ui/sidebar/index.js";
	import { Separator } from "$lib/components/ui/separator/index.js";
	import { Toaster } from "$lib/components/ui/sonner/index.js";
	import { PanelLeft } from "@lucide/svelte";
	import AppSidebar from "$lib/components/app-sidebar.svelte";
	import BgEffects from "$lib/components/bg-effects.svelte";
	import ThemeToggle from "$lib/components/theme-toggle.svelte";
	import SiteFooter from "$lib/components/site-footer.svelte";
	import VersionBanner from "$lib/components/version-banner.svelte";
	import ViewSwitch from "$lib/components/view-switch.svelte";
	import SearchButton from "$lib/components/search-button.svelte";
	import SearchPalette from "$lib/components/search-palette.svelte";
	import SidebarMemory from "$lib/components/sidebar-memory.svelte";
	import ListScrollMemory from "$lib/components/list-scroll-memory.svelte";
	import VisitRecorder from "$lib/components/visit-recorder.svelte";
	import { ModeWatcher } from "mode-watcher";
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
	import { getSidebarWidthPx } from "$lib/sidebar-width.svelte.js";
	import { adminEntryHref, rememberLastSitePath } from "$lib/view-switch-nav.js";
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

	// 前台顶栏的「后台」入口落点。判定复用 $lib/view-switch-nav 的**唯一**实现
	// （侧栏滑块、侧栏菜单项调用的是同一份，别再在这里写第二套条件）。
	// 未登录 / 无任何后台权限 → null → 顶栏该入口完全不渲染（访客看不到任何后台入口）。
	const adminHref = $derived(adminEntryHref(data.user));

	// 沉浸式全屏区：档案库引擎要在无任何站点外壳（无侧边栏/顶栏/盒框）下
	// 铺满整个视口，像原版 RhineLabUI 那样全屏沉浸。此路由脱离 Sidebar 外壳直接渲染。
	// /editor 是可视化界面编辑器，同样需要整屏裸渲染（三栏工具界面），纳入此分支。
	// /campus/classes 是三维班级档案库，同样要脱离站点外壳铺满视口。
	const isImmersive = $derived(
		page.url.pathname === "/docs/archives" ||
			page.url.pathname.startsWith("/editor") ||
		page.url.pathname === "/campus/classes" ||
		page.url.pathname.startsWith("/campus/2028/class8")
	);

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
		// 记下「不是 /admin 开头的最后访问路径」：后台的「前台」按钮要靠它回到
		// 你来修改之前看的那一页，而不是永远回首页。函数内部已跳过 /admin 前缀。
		rememberLastSitePath(page.url.pathname, page.url.search);
		// 读屏播报：客户端导航是「无刷新换页」，读屏不会自动感知。
		// 用 live region 在其后播报新页面标题；视觉用户完全无感。
		setTimeout(() => { announced = document.title; }, 60);
	});

	// 首屏兜底：SSR 直访时 reveal 元素初始 opacity:0（CSS 写死，仅 JS 解锁），
	// 但 hydration 后 use:reveal 的 setTimeout 在后台标签页/时序问题下常未及时跑，
	// 导致首屏内容卡在隐藏态，需用户点一次导航触发 replayReveals 才显形。
	// 这里在 hydration 完成后立即重放一次，确保首屏无需点击即自动浮现。
	onMount(() => {
		// 「hydration 已接管」的凭据 —— 给 app.html 里那道 3s 兜底闸看。
		// 拿不到它，兜底闸就会强制放行 .reveal（宁可丢动画，也不留空白页）。
		document.documentElement.classList.add("app-ready");
		try { replayReveals(); } catch { /* noop */ }
		// 直访（不进过 afterNavigate）时也要记一次来路，否则「刷新一次再进后台」会丢掉来路。
		rememberLastSitePath(page.url.pathname, page.url.search);
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
	// 搜索面板开关：顶栏按钮与快捷键都能改它（SearchPalette 内 bind:open 双向）
	let searchOpen = $state(false);

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


	// 灵动光晕跟随鼠标（桌面端）
	let glowEl: HTMLElement | null = null;
	function glowMove(e: MouseEvent) {
		if (!glowEl) glowEl = document.querySelector(".cursor-glow");
		if (!glowEl) return;
		glowEl.classList.add("on");
		glowEl.style.transform = "translate(" + (e.clientX) + "px, " + (e.clientY) + "px) translate(-50%, -50%)";
	}
	function glowHide() { if (glowEl) glowEl.classList.remove("on"); }
	onMount(() => {
		window.addEventListener("mousemove", glowMove, { passive: true });
		document.addEventListener("mouseleave", glowHide);
	});
	</script>

<svelte:head>
	<!-- 终末地字体走 jsDelivr CDN（不走本机）：Saira 全轴宽体(wdth+wght) + Noto Sans SC 中文黑体 -->
	<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource-variable/saira/standard.css" />
	<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource-variable/noto-sans-sc/index.css" />
	<link rel="icon" href={favicon} />
	<!-- color-scheme 由 mode-watcher 在运行时写 html 的 inline style（随主题变），
	     这里不再写死 content="dark" —— 写死会让亮色模式下浏览器仍按深色渲染
	     原生控件与滚动条。theme-color 保留为 SSR 深色兜底，运行时被改写。 -->
	<meta name="theme-color" content="#1b1b19" />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content={data.settings.title} />
	<meta name="twitter:card" content="summary_large_image" />
	<link rel="alternate" type="application/rss+xml" title={data.settings.title + " · 博客 RSS"} href="/rss.xml" />
	<!-- ⚠️ 这里刻意不写 description / og:title / og:description / og:url / canonical：
	     Svelte 的 svelte:head **不做去重**，布局与页面各写一份会同时输出两个标签，
	     而 OG 抓取器与搜索引擎通常取第一个 —— 布局里指向站根的 canonical 更糟，
	     它等于声明"此详情页是首页副本"，会把详情页踢出索引。
	     这些一律由页面级 <Seo> 组件提供（见 $lib/components/Seo.svelte）。 -->
</svelte:head>

	<!-- 主题：亮色 / 暗色 / 跟随系统。
	     defaultMode="dark" 是刻意的 —— 本站原本就是深色站，把默认值定成 dark
	     才不会让现有访客在刷新后「被动变亮」。注入到 <head> 的脚本在首帧绘制前
	     就写好类名，所以刷新时不会先亮后暗闪一下。 -->
	<ModeWatcher
		defaultMode="dark"
		disableTransitions={false}
		themeColors={{ dark: "#1b1b19", light: "#faf9f5" }}
	/>

	<!-- 全局动画背景 -->
	<BgEffects config={(data as any).settings?.background} />

	<!-- 全局通知 toast -->
	<Toaster richColors position="top-center" />

	<!-- 浏览轨迹记录：客户端导航时记下路径与标题，供「最近浏览」使用 -->
	<VisitRecorder />

	<!-- 列表页滚动位置记忆：返回列表时回到原处，而不是被弹回顶部 -->
	<ListScrollMemory />

	<!-- 搜索面板：Ctrl/⌘+K 或 / 唤起；由顶栏按钮与自身快捷键共同控制 -->
	<SearchPalette bind:open={searchOpen} />

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

{#if isImmersive}
	<!-- 沉浸式全屏：档案库等脱离站点外壳，children 裸渲染占满视口 -->
	{#key page.url.pathname}
		<div id="main-content" tabindex="-1" style="view-transition-name: none">
			{@render children()}
		</div>
	{/key}
{:else}
	<Sidebar.Provider style="--sidebar-width: {getSidebarWidthPx()}px">
		<!-- 移动端抽屉：导航后自动收起（必须在 Provider 内才能拿到 sidebar context） -->
		<SidebarAutoClose />

		<!-- 侧栏滚动位置记忆：前台/后台共用同一份键，切换过去不会"重置" -->
		<SidebarMemory />

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
					<span class="min-w-0 truncate text-sm text-muted-foreground">{data.settings.title}</span>
					<div class="ml-auto flex shrink-0 items-center gap-2 pl-2">
						<!-- 前台 / 后台切换：窄屏不拉抽屉也能一键进后台。
						     只对「进得了后台」的人渲染（adminHref 为 null 时整块不出现），
						     访客在前台看不到任何后台入口。 -->
						{#if adminHref}
							<ViewSwitch current="site" {adminHref} />
						{/if}
						<!-- 右上角搜索：点开即搜，不离开当前页 -->
						<SearchButton bind:open={searchOpen} />
						<ThemeToggle />
					</div>
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
			<!-- 全站页脚：双轨版本（semver + git commit）。后台 /admin 同走根 layout，一并展示。 -->
			{#if !isImmersive}
				<SiteFooter />
			{/if}
		</Sidebar.Inset>
	</Sidebar.Provider>
{/if}

<VersionBanner />
<div class="cursor-glow"></div>
