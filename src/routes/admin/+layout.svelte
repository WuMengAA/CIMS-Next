<script lang="ts">
	import type { Snippet } from "svelte";
	import * as Sidebar from "$lib/components/ui/sidebar/index.js";
	import { page } from "$app/state";
	import ConfirmHost from "$lib/components/admin/confirm-host.svelte";
	import ViewSwitch from "$lib/components/view-switch.svelte";
	import { pageIn } from "$lib/transition.js";
	import { LayoutDashboard, BookOpen, Rocket, BookMarked, Image, Link, Globe, ExternalLink, Settings, UsersRound, Inbox, LayoutList, MessageSquare, Megaphone, Flag, FileCheck2, GitPullRequestArrow, MessagesSquare, Rss, MonitorSmartphone, Activity, FileText } from "@lucide/svelte";

	let { children }: { children: Snippet } = $props();

	// 注意：这里**不要**再调 enableViewTransitions()。
	// onNavigate 是组件级生命周期，根布局已注册一份；后台布局再注册一份，
	// 同一次导航就会连开两次 View Transition，互相顶掉并抛出
	// "AbortError: Transition was skipped"。过渡作用域差异由下面的
	// view-transition-name（admin-content）控制，与是否注册无关。

	const nav = [
		{ title: "仪表盘", url: "/admin", icon: LayoutDashboard },
		{ title: "博客文章", url: "/admin/posts", icon: BookOpen },
		{ title: "项目管理", url: "/admin/projects", icon: Rocket },
		{ title: "文档资料", url: "/admin/docs", icon: BookMarked },
		{ title: "页面管理", url: "/admin/pages", icon: FileText },
		{ title: "媒体库", url: "/admin/media", icon: Image },
		{ title: "友情链接", url: "/admin/links", icon: Link },
		{ title: "友链申请", url: "/admin/link-applications", icon: Inbox },
		{ title: "评论审核", url: "/admin/comments", icon: MessageSquare },
		{ title: "公告管理", url: "/admin/announcements", icon: Megaphone },
		{ title: "订阅源/播报", url: "/admin/feed", icon: Rss },
		{ title: "反馈管理", url: "/admin/feedback", icon: Flag },
		{ title: "项目专页申请", url: "/admin/project-applications", icon: GitPullRequestArrow },
		{ title: "文档纠错", url: "/admin/doc-corrections", icon: FileCheck2 },
		{ title: "论坛管理", url: "/admin/forum", icon: MessagesSquare },
		{ title: "导航管理", url: "/admin/nav", icon: LayoutList },
		{ title: "用户管理", url: "/admin/users", icon: UsersRound },
		{ title: "活动中心", url: "/admin/activities", icon: Activity },
		{ title: "站点设置", url: "/admin/settings", icon: Settings },
		{ title: "集控面板", url: "/admin/console", icon: MonitorSmartphone },
		{ title: "服务存活", url: "/admin/health", icon: Activity }
	];

	const currentPath = $derived(page.url.pathname);

	// 登录页不要后台外壳：它是整屏居中的登录卡片，套在侧栏+顶栏里会被挤到右侧，
	// 还多出一列「点了就被 hooks 弹回」的导航。
	const isLogin = $derived(currentPath.startsWith("/admin/login"));

	async function logout() {
		await fetch("/api/auth", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "logout" })
		});
		window.location.href = "/admin/login";
	}
	function isActive(url: string): boolean {
		if (url === "/admin") return currentPath === "/admin";
		return currentPath.startsWith(url);
	}
</script>

<svelte:head>
	<title>管理后台 | Stelarith</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

{#if isLogin}
	{@render children()}
{:else}
<!--
  后台侧栏的定位约束（踩过一次，别再改回去）：
  admin 布局位于根布局的 <Sidebar.Inset> 内部，而后者是 flex-col —— 于是这里
  <Sidebar.Root> 的 sidebar-gap（本该在横向撑出 16rem 把内容挤到右边）被夹在
  纵向流里，宽度失效、高度为 0，fixed 的侧栏就直接盖在内容上（实测内容区
  x=0 w=1280，左侧统计卡被吃掉一大块，连顶栏按钮都点不到）。
  所以这里不靠 gap，改为由下面的 Inset 自己让出 md:pl-(--sidebar-width)，
  并用 peer-data-[collapsible=icon] 让它跟着折叠一起收回（两侧同 300ms，动画合拍）。
-->
<Sidebar.Root class="bg-sidebar text-sidebar-foreground">
	<ConfirmHost />
	<Sidebar.Header>
		<a href="/" class="flex items-center gap-3">
			<div class="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary font-heading text-sm font-semibold text-primary-foreground">S</div>
			<div class="flex flex-col gap-0.5 leading-none group-data-[collapsible=icon]:hidden">
				<span class="font-heading text-base font-semibold">Stelarith CMS</span>
				<span class="text-xs text-muted-foreground">内容管理</span>
			</div>
		</a>
	</Sidebar.Header>
	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.GroupLabel>内容管理</Sidebar.GroupLabel>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
				{#each nav as item (item.url)}
					<Sidebar.MenuItem>
						<Sidebar.MenuButton href={item.url} isActive={isActive(item.url)} tooltipContent={item.title}>
							<item.icon />
							<span>{item.title}</span>
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
				{/each}
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>
	</Sidebar.Content>
	<Sidebar.Footer>
		<!-- 前台 / 后台滑块：后台侧固定停在「后台」，点「前台」回站点 -->
		<ViewSwitch current="admin" class="mx-1 group-data-[collapsible=icon]:hidden" />
		<div class="flex items-center justify-between px-3">
			<p class="text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">Stelarith CMS</p>
			<button onclick={logout} class="text-xs text-muted-foreground hover:text-destructive">退出登录</button>
		</div>
	</Sidebar.Footer>
	<!-- 桌面端：侧栏右缘可点击收起（带宽度过渡），与前台侧栏行为一致 -->
	<Sidebar.Rail />
</Sidebar.Root>

<Sidebar.Inset class="transition-[padding] duration-300 ease-in-out md:pl-(--sidebar-width) md:peer-data-[collapsible=icon]:pl-(--sidebar-width-icon)">
	<Sidebar.Header class="border-b border-border px-3 md:px-6">
		<div class="flex items-center justify-between gap-2">
			<div class="flex min-w-0 items-center gap-2">
				<!-- 窄屏下侧栏是浮层抽屉：根布局的 trigger 只在非 admin 时渲染，
				     后台不自己放一个就完全没有入口（点不开 = 也看不到抽屉动画）。 -->
				<Sidebar.Trigger class="-ml-1 size-11 md:size-9" />
				<h2 class="truncate font-heading text-base font-semibold md:text-lg">管理后台</h2>
			</div>
			<a href="/" target="_blank" class="shrink-0 text-xs text-muted-foreground hover:text-foreground">查看前台</a>
		</div>
	</Sidebar.Header>
	<Sidebar.Content class="p-4 md:p-6">
		{#key currentPath}
			<div in:pageIn style="view-transition-name: admin-content">
				{@render children()}
			</div>
		{/key}
		</Sidebar.Content>
</Sidebar.Inset>
{/if}
