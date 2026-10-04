<script lang="ts">
	import { onMount, type Snippet } from "svelte";
	import * as Sidebar from "$lib/components/ui/sidebar/index.js";
	import { page } from "$app/state";
	import ConfirmHost from "$lib/components/admin/confirm-host.svelte";
	import ViewSwitch from "$lib/components/view-switch.svelte";
	import ThemeToggle from "$lib/components/theme-toggle.svelte";
	import { pageIn } from "$lib/transition.js";
	import { can, userCan, levelLabelOfXp, type Action } from "$lib/permissions.js";
	import { IA_BACKEND_MODULES, iaPlacementOf } from "$lib/ia.js";
	import { Avatar, AvatarImage, AvatarFallback } from "$lib/components/ui/avatar/index.js";
	import SidebarResizer from "$lib/components/sidebar-resizer.svelte";
	import { MorphIcon } from "morphicons/svelte";
	import { ChevronDown, ChevronUp } from "lucide";
	import { ICON_MAP } from "$lib/icon-library.js";
	import { Github, Twitter } from "$lib/components/icons/index.js";
	import { readGroupOpen, writeGroupOpen } from "$lib/sidebar-memory.js";
	import { KeyRound, LayoutDashboard, LayoutGrid, BookOpen, Rocket, BookMarked, Link, Globe, ExternalLink, Settings, UsersRound, GraduationCap, CalendarDays, CalendarClock, Inbox, LayoutList, MessageSquare, Megaphone, Send, Flag, FileCheck2, GitPullRequestArrow, MessagesSquare, Rss, MonitorSmartphone, MonitorCog, Activity, FileText, ShieldCheck, ShieldPlus, Archive, Paperclip, HardDrive, SlidersHorizontal, History, AppWindow, ScrollText, MonitorPlay, Dices, Volume2, Music2, Radio } from "@lucide/svelte";
	import { adminEntryHref, readLastSitePath } from "$lib/view-switch-nav.js";
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
	// 归属的「后台四大模块」（概览 / 内容与运营 / 用户与权限 / 设置）由 $lib/ia 单一真源
	// 决定 —— 本文件不再写 group，调整模块结构只改 ia.ts 一处（与 Flutter 端 ia.dart 同构）。
	type NavItem = { title: string; url: string; icon: any; need: Action };
	const NAV: NavItem[] = [
		// 概览：任何进得了后台的人都能看
		{ title: "仪表盘", url: "/admin", icon: LayoutDashboard, need: "viewAdmin" },
		{ title: "健康状态", url: "/admin/health", icon: Activity, need: "viewAdmin" },

		// 内容：L4 编辑及以上
		{ title: "博客文章", url: "/admin/posts", icon: BookOpen, need: "manageContent" },
		{ title: "项目管理", url: "/admin/projects", icon: Rocket, need: "manageContent" },
		// 项目展板：进度/待办/活跃度/Issues/发行。与「项目管理」分开是因为它管的是
		// 仓库绑定与同步这类运维动作，而不是正文内容本身。
		{ title: "项目展板", url: "/admin/project-board", icon: LayoutGrid, need: "manageContent" },
		{ title: "教程管理", url: "/admin/docs", icon: BookMarked, need: "manageContent" },
		{ title: "页面管理", url: "/admin/pages", icon: FileText, need: "managePages" },
		{ title: "附件库", url: "/admin/media", icon: Paperclip, need: "manageFiles" },
	{ title: "更新日志", url: "/admin/changelog", icon: History, need: "manageContent" },
		// 个人附件库 / 图床的跨账号总览：占用、配额赠送、强制清理。
		{ title: "存储空间", url: "/admin/library", icon: HardDrive, need: "manageStorage" },

		// 审核：L3 审核员及以上
		{ title: "评论审核", url: "/admin/comments", icon: MessageSquare, need: "moderate" },
		{ title: "反馈管理", url: "/admin/feedback", icon: Flag, need: "moderate" },
		{ title: "论坛管理", url: "/admin/forum", icon: MessagesSquare, need: "moderate" },
		{ title: "友链申请", url: "/admin/link-applications", icon: Inbox, need: "manageContent" },
		{ title: "项目专页申请", url: "/admin/project-applications", icon: GitPullRequestArrow, need: "moderate" },
		{ title: "文档纠错", url: "/admin/doc-corrections", icon: FileCheck2, need: "moderate" },
		// 权限申请：门槛用 reviewPermission（L5），与「能否真的批准」同源 ——
		// 用 moderate 会让「能审 UGC 但不能审权限」的角色看到点了必失败的入口。
		{ title: "权限申请", url: "/admin/role-requests", icon: ShieldPlus, need: "reviewPermission" },

		// 运营：L4 编辑及以上
		{ title: "公告管理", url: "/admin/announcements", icon: Megaphone, need: "manageContent" },
		{ title: "订阅源", url: "/admin/feed", icon: Rss, need: "manageContent" },
		{ title: "友情链接", url: "/admin/links", icon: Link, need: "manageContent" },
		{ title: "导航管理", url: "/admin/nav", icon: LayoutList, need: "manageContent" },
		{ title: "活动中心", url: "/admin/activities", icon: Activity, need: "viewAdmin" },

		// 设备集控：2026-10-04 收敛 —— 星集控作为**独立项目**收纳进侧栏「项目」折叠组
		// （见下方 PROJECT_NAV + 渲染），20 个子页全部经由集控项目首页的快捷入口进入，
		// 不再平铺在后台导航里占位置。入口门槛 viewConsole（L1 电教委员/只读也能进面板）。
		// 班级管理是班级 CMS（内容运营），不属于星集控项目，保持独立入口。
		{ title: "班级管理", url: "/admin/class8", icon: GraduationCap, need: "manageContent" },

		// 治理：L5 站长
		{ title: "用户管理", url: "/admin/users", icon: UsersRound, need: "manageUsers" },
		{ title: "权限总览", url: "/admin/permissions", icon: ShieldCheck, need: "viewConsole" },
		{ title: "归档管理", url: "/admin/archives", icon: Archive, need: "moderate" },
		// 登录授权 / API：本站作为授权服务器，供星集控桌面端 / VoiceHub 登录。
		// 门槛用 manageOAuth（新增的能力位，站长持有）—— 这页能看也能改 client_secret，
		// 后台布局的默认门槛只到 viewAdmin，不该让编辑级账号看到。
		{ title: "登录授权", url: "/admin/oauth", icon: KeyRound, need: "manageOAuth" },
		{ title: "站点设置", url: "/admin/settings", icon: Settings, need: "manageSettings" },
		{ title: "镜像站", url: "/admin/mirror", icon: Globe, need: "manageSettings" }
	];

	const role = $derived((data as any)?.user?.role as any);
	// 经验等级（#248：xp→Lv，纯展示，与权限/角色零耦合）。
	const levelLabel = $derived(levelLabelOfXp((data as any)?.user?.xp ?? 0));

	// 按能力过滤，再按「后台四大模块」归拢：无权限的整组自动消失。
	// 模块归属来自 ia.ts（IA_BACKEND_MODULES / iaPlacementOf），本文件不再定义分组。
	const navGroups = $derived.by(() => {
		const allowed = NAV.filter((i) => userCan(data.user as any, i.need));
		return IA_BACKEND_MODULES
			.map((m) => {
				const items = allowed
					.filter((i) => iaPlacementOf(i.url).module === m)
					.map((i) => ({ ...i, sub: iaPlacementOf(i.url).sub }));
				return { group: m as string, items };
			})
			.filter((g) => g.items.length > 0);
	});

	// ── 「项目」折叠组（2026-10-04）：星集控这类独立项目收在这里，后台与前台同构，
	//    同一条记忆键（"projects"）→ 用户在前后台切来切去，项目组的收起/展开不打架。
	//    默认展开（前台默认收起，后台反过来）：前台是内容站，独立项目不该抢占常驻位置；
	//    后台是管理界面，使用者不缺这点空间，多一次点击纯属添麻烦。
	const PROJECT_NAV: NavItem[] = [
		{ title: "星集控", url: "/admin/console", icon: MonitorSmartphone, need: "viewConsole" },
	];
	const projectNav = $derived(PROJECT_NAV.filter((i) => userCan(data.user as any, i.need)));

	let adminProjectOpen = $state(true);
	let adminProjectHydrated = $state(false);
	$effect(() => {
		if (adminProjectHydrated) return;
		adminProjectHydrated = true;
		adminProjectOpen = readGroupOpen("projects", true);
	});
	function toggleAdminProject(): void {
		adminProjectOpen = !adminProjectOpen;
		writeGroupOpen("projects", adminProjectOpen);
	}

	/**
	 * 自定义导航组（镜像站等）在后台侧栏同样呈现 —— 用户心里只有一个侧边栏，
	 * 前台配好的分组不该在后台消失。只过滤掉「仅前台」的组（showIn === "site"）。
	 *
	 * 图标解析复用 IconPicker 的权威表 ICON_MAP（用户在后台能选到的名字都能解析），
	 * 再补几个自定义 SVG 图标（GitHub/X 不在 lucide 命名空间里）。
	 */
	const groupIconMap: Record<string, any> = { github: Github, twitter: Twitter, x: Twitter };
	function resolveGroupIcon(name?: string): any {
		const k = (name || "").toLowerCase();
		return groupIconMap[k] || ICON_MAP[k] || Globe;
	}

	const customGroups = $derived(
		((((data as any)?.nav?.groups ?? []) as any[]))
			.filter((g) => (g?.showIn ?? "both") !== "site")
			.map((g) => ({ ...g, icon: resolveGroupIcon(g?.icon) }))
	);

	// 展开态：首屏按配置的 collapsed 推导（SSR 与客户端一致），再用本地记忆覆盖。
	let groupOpen = $state<Record<string, boolean>>({});
	let groupsHydrated = $state(false);
	$effect(() => {
		if (groupsHydrated) return;
		groupsHydrated = true;
		const next: Record<string, boolean> = {};
		for (const g of customGroups) next[g.key] = readGroupOpen(g.key, g.collapsed !== true);
		groupOpen = next;
	});
	function isGroupOpen(g: { key: string; collapsed?: boolean }): boolean {
		return groupOpen[g.key] ?? g.collapsed !== true;
	}
	function toggleGroup(g: { key: string; collapsed?: boolean }): void {
		const next = !isGroupOpen(g);
		groupOpen = { ...groupOpen, [g.key]: next };
		writeGroupOpen(g.key, next);
	}

	const currentPath = $derived(page.url.pathname);

	// 「回前台」的落点 = 我来后台之前在前台看的那一页（根布局把非 /admin 的最后路径写进 sessionStorage）。
	// 首帧（SSR）只能是 "/"，挂载后换成真实来路 —— ViewSwitch 的 options 是 $derived，
	// href 会跟着更新。没有它，点「前台」永远回首页，刚在改的那一篇得重新翻。
	let siteHref = $state("/");
	onMount(() => { siteHref = readLastSitePath(); });

	// 「后台」那一格的落点：同样走 $lib/view-switch-nav 的唯一判定，
	// 免得只有集控权限的人点到一个自己进不去的 /admin（会被 hooks 弹回来）。
	const adminHref = $derived(adminEntryHref(data.user) ?? "/admin");

	// 登录页不要后台外壳：它是整屏居中的登录卡片，套在侧栏+顶栏里会被挤到右侧，
	// 还多出一列「点了就被 hooks 弹回」的导航。
	const isLogin = $derived(currentPath.startsWith("/admin/login"));

	// 裸嵌入模式：?embed=1 时只渲染内容区（无侧栏/顶栏外壳），
	// 供「设备管理 / 消息中心」tab 壳页用同源 iframe 聚合子页面。
	const isEmbed = $derived(page.url.searchParams.get("embed") === "1");

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

{#if isLogin || isEmbed}
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
					{#each g.items as item, i (item.url)}
						<!-- 模块内小标题：仅在「有 sub 且与上一条不同」时出现，把 15+ 项的
						     大模块（内容与运营）再切几个语义簇，避免一堵选项墙。 -->
						{#if item.sub && (i === 0 || g.items[i - 1].sub !== item.sub)}
							<div class="px-2 pt-2 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground/60 group-data-[collapsible=icon]:hidden">{item.sub}</div>
						{/if}
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
		<!-- 自定义组（镜像站等）：与前台同源（content/nav.json），后台只筛掉「仅前台」的组。
		     排列方式与前台一致（list/grid/inline），保证同一个组在两处长得一样。 -->
		{#each customGroups as g (g.key)}
			<Sidebar.Group>
				<Sidebar.GroupContent>
					<Sidebar.Menu>
						<Sidebar.MenuItem>
							<Sidebar.MenuButton
								onclick={() => toggleGroup(g)}
								aria-expanded={isGroupOpen(g)}
								tooltipContent={g.label}
							>
								<g.icon />
								<span class="group-data-[collapsible=icon]:hidden">{g.label}</span>
								<MorphIcon
									icon={isGroupOpen(g) ? ChevronUp : ChevronDown}
									spring="snappy"
									reducedMotion="user"
									size={16}
									aria-hidden="true"
									class="ml-auto group-data-[collapsible=icon]:hidden"
								/>
							</Sidebar.MenuButton>
							{#if isGroupOpen(g)}
								{#if g.layout === "grid"}
									<Sidebar.MenuSub class="grid grid-cols-2 gap-1 px-1.5 py-1">
										{#each g.items as item (item.url)}
											{@const Icon = resolveGroupIcon(item.icon)}
											<Sidebar.MenuSubItem>
												<a
													href={item.url}
													target={item.external ? "_blank" : undefined}
													rel={item.external ? "noopener noreferrer" : undefined}
													title={item.title}
													class="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
												>
													<Icon class="size-3.5 shrink-0" />
													<span class="truncate">{item.title}</span>
												</a>
											</Sidebar.MenuSubItem>
										{/each}
									</Sidebar.MenuSub>
								{:else if g.layout === "inline"}
									<Sidebar.MenuSub class="flex-row flex-wrap gap-1 px-1.5 py-1">
										{#each g.items as item (item.url)}
											{@const Icon = resolveGroupIcon(item.icon)}
											<Sidebar.MenuSubItem>
												<a
													href={item.url}
													target={item.external ? "_blank" : undefined}
													rel={item.external ? "noopener noreferrer" : undefined}
													title={item.title}
													aria-label={item.title}
													class="flex size-7 items-center justify-center rounded-md text-sidebar-foreground ring-sidebar-ring transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2"
												>
													<Icon class="size-4" />
												</a>
											</Sidebar.MenuSubItem>
										{/each}
									</Sidebar.MenuSub>
								{:else}
									<Sidebar.MenuSub>
										{#each g.items as item (item.url)}
											{@const Icon = resolveGroupIcon(item.icon)}
											<Sidebar.MenuSubItem>
												<Sidebar.MenuSubButton
													href={item.url}
													target={item.external ? "_blank" : undefined}
													rel={item.external ? "noopener noreferrer" : undefined}
												>
													<Icon />
													<span>{item.title}</span>
												</Sidebar.MenuSubButton>
											</Sidebar.MenuSubItem>
										{/each}
									</Sidebar.MenuSub>
								{/if}
							{/if}
						</Sidebar.MenuItem>
					</Sidebar.Menu>
				</Sidebar.GroupContent>
			</Sidebar.Group>
		{/each}
		<!-- 项目折叠组（2026-10-04）：星集控等独立项目收在这里，默认展开（与前台相反）。
		     与前台 app-sidebar 的「项目」组同构、同记忆键（projects）。 -->
		{#if projectNav.length > 0}
			<Sidebar.Group>
				<Sidebar.GroupContent>
					<Sidebar.Menu>
						<Sidebar.MenuItem>
							<Sidebar.MenuButton onclick={toggleAdminProject} aria-expanded={adminProjectOpen} tooltipContent="项目">
								<Rocket />
								<span class="group-data-[collapsible=icon]:hidden">项目</span>
								<span class="ml-auto group-data-[collapsible=icon]:hidden"></span>
								<MorphIcon
									icon={adminProjectOpen ? ChevronUp : ChevronDown}
									spring="snappy"
									reducedMotion="user"
									size={16}
									aria-hidden="true"
								/>
							</Sidebar.MenuButton>
							{#if adminProjectOpen}
								<Sidebar.MenuSub>
									{#each projectNav as item (item.url)}
										<Sidebar.MenuSubItem>
											<Sidebar.MenuSubButton href={item.url} isActive={isActive(item.url)}>
												<item.icon />
												<span>{item.title}</span>
											</Sidebar.MenuSubButton>
										</Sidebar.MenuSubItem>
									{/each}
								</Sidebar.MenuSub>
							{/if}
						</Sidebar.MenuItem>
					</Sidebar.Menu>
				</Sidebar.GroupContent>
			</Sidebar.Group>
		{/if}
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
		<!-- 前台 / 后台滑块：后台侧固定停在「后台」，点「前台」回到进后台之前那一页
		     （来路由根布局记录，见 siteHref）。后台顶栏原先那个 target="_blank" 的
		     「查看前台」已删除 —— 同一个「回前台」有两处入口、两种行为，用户不知道点哪个。 -->
		<ViewSwitch current="admin" {adminHref} {siteHref} class="mx-1 group-data-[collapsible=icon]:hidden" />
		<div class="flex items-center justify-between gap-2 px-3">
			<!-- 经验等级徽标（#248：xp→Lv 纯展示，与权限无关；权限看称号/角色） -->
			<span class="truncate rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground group-data-[collapsible=icon]:hidden" title="经验等级（与权限无关）">{levelLabel}</span>
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
