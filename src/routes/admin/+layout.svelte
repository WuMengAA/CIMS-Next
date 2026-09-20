<script lang="ts">
	import type { Snippet } from "svelte";
	import * as Sidebar from "$lib/components/ui/sidebar/index.js";
	import { page } from "$app/state";
	import ConfirmHost from "$lib/components/admin/confirm-host.svelte";
	import ViewSwitch from "$lib/components/view-switch.svelte";
	import ThemeToggle from "$lib/components/theme-toggle.svelte";
	import { pageIn } from "$lib/transition.js";
	import { can, userCan, roleLevelLabel, type Action } from "$lib/permissions.js";
	import { Avatar, AvatarImage, AvatarFallback } from "$lib/components/ui/avatar/index.js";
	import SidebarResizer from "$lib/components/sidebar-resizer.svelte";
	import { LayoutDashboard, BookOpen, Rocket, BookMarked, Link, Globe, ExternalLink, Settings, UsersRound, Inbox, LayoutList, MessageSquare, Megaphone, Flag, FileCheck2, GitPullRequestArrow, MessagesSquare, Rss, MonitorSmartphone, Activity, FileText, ShieldCheck, ShieldPlus, Archive, Paperclip } from "@lucide/svelte";
	import type { LayoutProps } from "./$types";

	const { children, data }: LayoutProps = $props();

	// 注意：这里**不要**再调 enableViewTransitions()。
	// onNavigate 是组件级生命周期，根布局已注册一份；后台布局再注册一份，
	// 同一次导航就会连开两次 View Transition，互相顶掉并抛出
	// "AbortError: Transition was skipped"。过渡作用域差异由下面的
	// view-transition-name（admin-content）控制，与是否注册无关。

	// 导航按「能力」而非「角色」声明：每项标注所需 Action，渲染时用 can() 过滤。
	// 这样调整等级只改 permissions.ts 一处，导航自动跟着收敛 —— 且不可能出现
	// 「菜单看得见、点进去被 403」的错配（那是按角色硬编码时的经典漏网）。
	// group 用于把菜单分成几段，低权限用户看到的段数会自然变少。
	type NavItem = { title: string; url: string; icon: any; need: Action; group: string };
	const NAV: NavItem[] = [
		// 概览：任何进得了后台的人都能看
		{ title: "仪表盘", url: "/admin", icon: LayoutDashboard, need: "viewAdmin", group: "概览" },
		{ title: "服务存活", url: "/admin/health", icon: Activity, need: "viewAdmin", group: "概览" },

		// 内容：L4 编辑及以上
		{ title: "博客文章", url: "/admin/posts", icon: BookOpen, need: "manageContent", group: "内容" },
		{ title: "项目管理", url: "/admin/projects", icon: Rocket, need: "manageContent", group: "内容" },
		{ title: "教程管理", url: "/admin/docs", icon: BookMarked, need: "manageContent", group: "内容" },
		{ title: "页面管理", url: "/admin/pages", icon: FileText, need: "managePages", group: "内容" },
		{ title: "附件库", url: "/admin/media", icon: Paperclip, need: "manageFiles", group: "内容" },

		// 审核：L3 审核员及以上
		{ title: "评论审核", url: "/admin/comments", icon: MessageSquare, need: "moderate", group: "审核" },
		{ title: "反馈管理", url: "/admin/feedback", icon: Flag, need: "moderate", group: "审核" },
		{ title: "论坛管理", url: "/admin/forum", icon: MessagesSquare, need: "moderate", group: "审核" },
		{ title: "友链申请", url: "/admin/link-applications", icon: Inbox, need: "manageContent", group: "审核" },
		{ title: "项目专页申请", url: "/admin/project-applications", icon: GitPullRequestArrow, need: "moderate", group: "审核" },
		{ title: "文档纠错", url: "/admin/doc-corrections", icon: FileCheck2, need: "moderate", group: "审核" },
		// 权限申请：门槛用 reviewPermission（L5），与「能否真的批准」同源 ——
		// 用 moderate 会让「能审 UGC 但不能审权限」的角色看到点了必失败的入口。
		{ title: "权限申请", url: "/admin/role-requests", icon: ShieldPlus, need: "reviewPermission", group: "审核" },

		// 运营：L4 编辑及以上
		{ title: "公告管理", url: "/admin/announcements", icon: Megaphone, need: "manageContent", group: "运营" },
		{ title: "订阅源/播报", url: "/admin/feed", icon: Rss, need: "manageContent", group: "运营" },
		{ title: "友情链接", url: "/admin/links", icon: Link, need: "manageContent", group: "运营" },
		{ title: "导航管理", url: "/admin/nav", icon: LayoutList, need: "manageContent", group: "运营" },
		{ title: "活动中心", url: "/admin/activities", icon: Activity, need: "viewAdmin", group: "运营" },

		// 设备集控：等级轴只需要 L1（能进面板），实际能做什么由设备轴决定，
		// 所以这里用 viewConsole 而非 manageContent —— 电教委员/只读也能看到入口。
		{ title: "集控面板", url: "/admin/console", icon: MonitorSmartphone, need: "viewConsole", group: "设备" },

		// 治理：L5 站长
		{ title: "用户管理", url: "/admin/users", icon: UsersRound, need: "manageUsers", group: "治理" },
		{ title: "权限总览", url: "/admin/permissions", icon: ShieldCheck, need: "viewConsole", group: "治理" },
		{ title: "归档管理", url: "/admin/archives", icon: Archive, need: "moderate", group: "治理" },
		{ title: "站点设置", url: "/admin/settings", icon: Settings, need: "manageSettings", group: "治理" }
	];

	const GROUP_ORDER = ["概览", "内容", "审核", "运营", "设备", "治理"];

	const role = $derived((data as any)?.user?.role as any);
	const levelLabel = $derived(roleLevelLabel(role));

	// 按能力过滤，再按固定分组顺序归拢：无权限的整组自动消失。
	const navGroups = $derived.by(() => {
		const allowed = NAV.filter((i) => userCan(data.user as any, i.need));
		return GROUP_ORDER
			.map((g) => ({ group: g, items: allowed.filter((i) => i.group === g) }))
			.filter((g) => g.items.length > 0);
	});

	const currentPath = $derived(page.url.pathname);

	// 登录页不要后台外壳：它是整屏居中的登录卡片，套在侧栏+顶栏里会被挤到右侧，
	// 还多出一列「点了就被 hooks 弹回」的导航。
	const isLogin = $derived(currentPath.startsWith("/admin/login"));

	// 仅用于控制内容区 padding：集控面板自身带完整顶栏/侧栏/状态栏，应贴边铺满，
	// 不留内容区内边距；其它后台页保留 p-4 md:p-6。不用于渲染跳转判断。
	const isConsole = $derived(currentPath.startsWith("/admin/console"));

	// 集控面板现在**走后台外壳**（不再是全屏接管）：用户选择把它做成后台的一个页面，
	// 与站点 CMS 导航共享后台侧栏 + 顶栏 + 账号体系。面板自身仍带一套完整的设备级
	// 左侧导航（总览/课表/设备…），与 CMS 导航是两个维度，双重侧栏是预期而非 bug。
	// 移动端两块侧栏各自是浮层抽屉：后台的 Sidebar.Trigger 在顶栏、面板内的 #btn-nav
	// 在面板顶栏，互不遮挡、都可达。

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
<Sidebar.Root collapsible="icon" class="bg-sidebar text-sidebar-foreground">
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
		<!-- 导航按能力过滤后分组渲染：低等级用户看不到无权的整组，
		     而不是看到一堆点了被弹回的灰项。每组标题带该组所需等级提示。 -->
		{#each navGroups as g (g.group)}
			<Sidebar.Group>
				<Sidebar.GroupLabel>{g.group}</Sidebar.GroupLabel>
				<Sidebar.GroupContent>
					<Sidebar.Menu>
					{#each g.items as item (item.url)}
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
		{/each}
	</Sidebar.Content>
	<Sidebar.Footer>
		<!-- 账号卡：登录用户本体（头像/昵称/角色）常驻侧栏底部，前后台一致可见 -->
		{#if data.user}
			<a
				href="/admin/users"
				class="mx-1 mb-1 flex items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-sidebar-accent group-data-[collapsible=icon]:mx-0 group-data-[collapsible=icon]:justify-center"
			>
				<Avatar class="size-8 shrink-0">
					<AvatarImage src={data.user.avatar} alt={data.user.displayName} />
					<AvatarFallback class="bg-primary/15 text-xs text-primary">
						{(data.user.displayName || data.user.username).slice(0, 1).toUpperCase()}
					</AvatarFallback>
				</Avatar>
				<div class="flex min-w-0 flex-col leading-tight group-data-[collapsible=icon]:hidden">
					<span class="truncate text-sm font-medium">{data.user.displayName}</span>
					<span class="truncate text-xs text-muted-foreground">@{data.user.username} · {levelLabel}</span>
				</div>
			</a>
		{/if}
		<!-- 前台 / 后台滑块：后台侧固定停在「后台」，点「前台」回站点 -->
		<ViewSwitch current="admin" class="mx-1 group-data-[collapsible=icon]:hidden" />
		<div class="flex items-center justify-between gap-2 px-3">
			<!-- 等级徽标：让当前账号的权限级别随时可见，不必去用户管理页查 -->
			<span class="truncate rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground group-data-[collapsible=icon]:hidden">{levelLabel}</span>
			<button onclick={logout} class="text-xs text-muted-foreground transition-colors hover:text-destructive">退出登录</button>
		</div>
	</Sidebar.Footer>
	<!-- 桌面端：侧栏右缘可点击收起（带宽度过渡），与前台侧栏行为一致 -->
	<Sidebar.Rail />
	<SidebarResizer />
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
			<div class="flex shrink-0 items-center gap-3">
				<!-- 后台同样可切主题：ModeWatcher 挂在根布局，这里只是给个入口 -->
				<ThemeToggle />
				<a href="/" target="_blank" class="text-xs text-muted-foreground hover:text-foreground">查看前台</a>
			</div>
		</div>
	</Sidebar.Header>
	<!-- 集控面板：包装 div 要成为有确定高度的 flex 容器（h-full + flex-col），
	     否则里面 .console-root 的 flex:1 会失效、面板塌缩成横带。
	     注意：view-transition-name 会让本 div 变成 containing block，所以绝对定位
	     的子元素会相对它定位——它一旦没高度，面板就扁。故这里绝不用 absolute 撑满，
	     改用正常流 flex。集控页内容区去 padding（!p-0），让面板贴边铺满。 -->
	<Sidebar.Content class="relative p-4 md:p-6 {isConsole ? '!p-0' : ''}">
		{#key currentPath}
			<div in:pageIn style="view-transition-name: admin-content" class={isConsole ? 'flex h-full min-h-0 flex-col' : ''}>
				{@render children()}
			</div>
		{/key}
		</Sidebar.Content>
</Sidebar.Inset>
{/if}
