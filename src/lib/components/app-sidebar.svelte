<script lang="ts">
	import * as Sidebar from "$lib/components/ui/sidebar/index.js";
	import {
		Home,
		BookOpen,
		Sparkles,
		BookMarked,
		Clapperboard,
		Gamepad2,
		Wrench,
		Rocket,
		MoreHorizontal,
		Megaphone,
		Link,
		Archive,
		MessageSquare,
		Wallet,
		User,
		Heart,
		Send,
		MessageCircle,
		Globe,
		Music2,
		Newspaper,
		Rss,
		MessagesSquare,
		LogIn,
		FileText,
		Search,
		School,
		GraduationCap,
		Radio,
		MonitorSmartphone
	} from "@lucide/svelte";
	import { Github, Twitter } from "$lib/components/icons/index.js";
	import { MorphIcon } from "morphicons/svelte";
	import { ChevronDown, ChevronUp } from "lucide";
	// 只借 Role 类型：侧栏收到的 data.user.role 就是数据库里的角色值（根布局 load 下发），
	// 之前这里手写成 string，害得判定函数只能靠 `as any` 硬塞，类型帮不上忙。
	import type { Role } from "$lib/permissions.js";
	import { adminEntryHref } from "$lib/view-switch-nav.js";
	import { readMoreOpen, writeMoreOpen, readCampusOpen, writeCampusOpen, readGroupOpen, writeGroupOpen } from "$lib/sidebar-memory.js";
	import SidebarResizer from "$lib/components/sidebar-resizer.svelte";
	import { ICON_MAP } from "$lib/icon-library.js";
	
	import { page } from "$app/state";

	type NavLink = { title: string; url: string; icon?: string; external?: boolean };
	/**
	 * 自定义导航组（镜像站等）。与后端 content-store.ts 的 NavGroup 同构；
	 * layout 决定条目排列方式：list=单列 / grid=两列格子 / inline=一行图标。
	 */
	type NavGroupCfg = {
		key: string;
		label: string;
		icon?: string;
		layout?: "list" | "grid" | "inline";
		collapsed?: boolean;
		showIn?: "site" | "admin" | "both";
		items: NavLink[];
	};

	let { data }: { data?: {
		settings?: { socials?: { name: string; url: string }[]; siteName?: string; slogan?: string };
		nav?: { workspace: NavLink[]; more: NavLink[]; bottom: NavLink[]; campus?: NavLink[]; groups?: NavGroupCfg[] };
		user?: { username?: string; role?: Role | null } | null;
		canEdit?: boolean;
	} } = $props();

	// Fallback socials and dynamic mapping
	const fallbackSocials = [
		{ name: "GitHub", icon: Github, url: "https://github.com/afoim" },
		{ name: "Twitter", icon: Twitter, url: "https://x.com/Stelarith_" }
	];

	const iconMap: Record<string, any> = {
		"github": Github, "twitter": Twitter, "x": Twitter,
		"爱发电": Heart, "ifdian": Heart, "heart": Heart,
		"哔哩哔哩": Send, "bilibili": Send, "b站": Send,
		"qq": MessageCircle, "qq群": MessageCircle, "telegram": Send, "tg": Send
	};

	const socials = $derived(
		(data?.settings?.socials && data.settings.socials.length > 0 ? data.settings.socials : fallbackSocials)
			.map((s) => ({ name: s.name, url: s.url, icon: iconMap[s.name.toLowerCase()] || iconMap[s.name] || Globe }))
	);

	// Default nav arrays (used when nav config absent)
	// 注意：不要在这里放「只有标题、没有内容」的占位页（AI 绘图 / 交互小说 / 追番 / 游戏 / 钱包），
	// 它们会让导航显得又散又空。待功能真正落地后再在此处与 content/nav.json 同步挂出。
	const defaultWorkspace = [
		{ title: "首页", url: "/", icon: "home" },
		{ title: "更新日志", url: "/changelog", icon: "clock" },
		{ title: "站点动态", url: "/pulse", icon: "activity" },
		{ title: "项目", url: "/projects", icon: "projects" },
		{ title: "教程", url: "/docs", icon: "docs" },
		{ title: "页面", url: "/pages", icon: "pages" },
		{ title: "工具集", url: "/tools", icon: "tools" }
	];
	const defaultMore = [
		{ title: "搜索", url: "/search", icon: "search" },
		{ title: "公告", url: "/announcements", icon: "announcements" },
		{ title: "连接", url: "/links", icon: "links" },
		{ title: "订阅", url: "/subscribe", icon: "rss" },
		{ title: "旧站归档", url: "/archives", icon: "archives" },
		{ title: "反馈", url: "/feedback", icon: "feedback" }
	];
	const defaultBottom = [
		{ title: "管理后台", url: "/admin", icon: "admin" },
		{ title: "账号", url: "/account", icon: "account" }
	];
	const defaultCampus = [
		{ title: "学校一览", url: "/campus/school", icon: "school" },
		{ title: "班级展板", url: "/campus/2028/class8", icon: "monitor" },
		{ title: "班级风貌", url: "/campus/classes", icon: "graduation" },
		{ title: "校园广播", url: "/campus/broadcast", icon: "radio" }
		// 2026-10-04：集控面板不再挂在前台「校园」组（重点位置只放站点内容），
		// 星集控收纳进下方「项目」折叠组（默认收起，见 defaultProjects）。
	];

	// 2026-10-04 「项目」折叠组：站点的项目化收纳层 —— 星集控作为独立项目收在
	// 折叠组里，默认收起，不占前台重点位置。以后新项目（镜像站/站点本体…）加一条即可。
	const defaultProjects = [
		{ title: "星集控", url: "/admin/console", icon: "monitor" }
	];

	const navIconMap: Record<string, any> = {
		"home": Home, "blog": BookOpen, "posts": BookOpen, "bookopen": BookOpen,
		"project": Rocket, "projects": Rocket, "rocket": Rocket, "doc": BookMarked, "docs": BookMarked, "bookmarked": BookMarked,
		"create": Sparkles, "sparkles": Sparkles, "novel": BookMarked, "novels": BookMarked, "anime": Clapperboard, "clapperboard": Clapperboard,
		"game": Gamepad2, "games": Gamepad2, "gamepad2": Gamepad2, "tool": Wrench, "tools": Wrench, "wrench": Wrench,
		"announcement": Megaphone, "announcements": Megaphone, "megaphone": Megaphone, "link": Link, "links": Link,
		"rss": Rss, "subscribe": Rss, "newspaper": Newspaper,
		"archive": Archive, "archives": Archive, "feedback": MessageSquare, "messagesquare": MessageSquare,
		"admin": Wrench, "wallet": Wallet, "user": User, "account": User, "users": User,
		"music": Music2, "forum": MessagesSquare, "news": Newspaper, "pages": FileText,
		"search": Search, "layoutdashboard": FileText,
		"school": School, "graduation": GraduationCap, "graduationcap": GraduationCap,
		"radio": Radio, "broadcast": Radio, "console": MonitorSmartphone, "monitor": MonitorSmartphone
	};

	const workspace = $derived(
		(data?.nav?.workspace && data.nav.workspace.length > 0 ? data.nav.workspace : defaultWorkspace)
			.map(i => ({ ...i, icon: navIconMap[(i.icon || i.title).toLowerCase()] || ICON_MAP[(i.icon || "").toLowerCase()] || Home }))
	);
	const more = $derived(
		(data?.nav?.more && data.nav.more.length > 0 ? data.nav.more : defaultMore)
			.map(i => ({ ...i, icon: navIconMap[(i.icon || i.title).toLowerCase()] || ICON_MAP[(i.icon || "").toLowerCase()] || Globe }))
	);
	const bottom = $derived(
		(data?.nav?.bottom && data.nav.bottom.length > 0 ? data.nav.bottom : defaultBottom)
			.map(i => ({ ...i, icon: navIconMap[(i.icon || i.title).toLowerCase()] || ICON_MAP[(i.icon || "").toLowerCase()] || Globe }))
	);
	const campus = $derived(
		(data?.nav?.campus && data.nav.campus.length > 0 ? data.nav.campus : defaultCampus)
			.map(i => ({ ...i, icon: navIconMap[(i.icon || i.title).toLowerCase()] || ICON_MAP[(i.icon || "").toLowerCase()] || School }))
	);

	// 「更多」展开态从本地记忆恢复（前后台共用），并在切换时写回 ——
	// 否则用户每次刷新都要重新点开「更多」找同一批入口。
	let moreOpen = $state(false);
	let moreHydrated = $state(false);
	// 「校园」分组：默认折叠，展开态从本地记忆恢复（与「更多」共用记忆机制）。
	let campusOpen = $state(false);
	let campusHydrated = $state(false);
	// 管理类入口（后台/钱包/账号）仅登录用户可见：登录态由根 layout 的 load 同步下发
	// （data.user），服务端已判定，无需客户端再发请求，侧边栏零闪烁、彻底常驻。
	const authed = $derived(!!(data?.user));

	// 后台入口：判定收敛到 $lib/view-switch-nav 的**唯一**实现（后台顶栏、前台顶栏、
	// 这里的滑块与菜单项全部调它），别在这儿再写一套条件——三处各判一套必然漂移，
	// 会出现「有滑块但没有后台菜单项」这种错配。
	// 返回 null = 不进后台（未登录 / 无 viewAdmin 也无 viewConsole）→ 相关入口一律不渲染。
	const adminHref = $derived(adminEntryHref(data?.user));

	// 底部固定组：摘掉 nav.json 里指向后台的那条（「后台 → /admin」）。
	// 「去后台」全站只保留侧栏底部滑块一个入口、一种行为；两处并存时显隐条件还会不一致
	// （原先一条用 canEdit、滑块用 viewAdmin||viewConsole），用户不知道该点哪个。
	const bottomLinks = $derived(bottom.filter((b) => !b.url.startsWith("/admin")));

	// 校园组里也挂着后台入口（默认项「集控面板 → /admin/console」）：
	// 未登录 / 无权限时一并藏掉，否则访客在前台会看到一个点进去就被弹回登录页的后台入口。
	// 判定同上（adminHref），电教委员仍有 viewConsole → 照常显示。
	const campusLinks = $derived(adminHref ? campus : campus.filter((i) => !i.url.startsWith("/admin")));

	// 「项目」折叠组（2026-10-04）：星集控这类独立项目收在这里，默认收起。
	// 访问门槛与后台入口一致（adminHref）：未登录 / 无 viewAdmin 也无 viewConsole 时整组隐藏。
	// 图标解析与 campus 同构：defaultProjects 里存的是 icon 名，map 成组件再渲染。
	const projectLinks = $derived(
		(adminHref ? defaultProjects : defaultProjects.filter((i) => !i.url.startsWith("/admin")))
			.map((i) => ({ ...i, icon: navIconMap[(i.icon || i.title).toLowerCase()] || ICON_MAP[(i.icon || "").toLowerCase()] || Rocket }))
	);
	let projectOpen = $state(false);
	let projectHydrated = $state(false);

	// 首帧后再读记忆：SSR 阶段没有 localStorage，且若在初始化时读会导致
	// 服务端渲染的 HTML 与客户端不一致（hydration mismatch）。
	$effect(() => {
		if (moreHydrated) return;
		moreHydrated = true;
		moreOpen = readMoreOpen();
		campusOpen = readCampusOpen();
		campusHydrated = true;
	});

	// 项目折叠组展开态：默认收起。用通用 group map 记忆（键 "projects"，
	// 与后台自定义组同一套持久化，删组自然被覆盖），不新增专用键。
	$effect(() => {
		if (projectHydrated) return;
		projectHydrated = true;
		projectOpen = readGroupOpen("projects", false);
	});
	function toggleProject(): void {
		projectOpen = !projectOpen;
		writeGroupOpen("projects", projectOpen);
	}

	/**
	 * 自定义组（镜像站等）—— 后台「导航管理」增删，前台按 showIn 过滤掉仅后台可见的组。
	 * 图标与固定组共用解析表，缺省回落到 Globe（而不是不渲染图标，避免行高跳动）。
	 */
	function resolveIcon(name: string | undefined, fallback: any): any {
		const k = (name || "").toLowerCase();
		return navIconMap[k] || ICON_MAP[k] || fallback;
	}

	const customGroups = $derived(
		((data?.nav?.groups ?? []) as NavGroupCfg[])
			.filter((g) => (g.showIn ?? "both") !== "admin")
			.map((g) => ({ ...g, icon: resolveIcon(g.icon, Globe) }))
	);

	// 展开态：首屏直接用配置里的 collapsed 推导（服务端与客户端算出同一个值，
	// 不会 hydration 抖动），客户端首帧后再用本地记忆覆盖 —— 与「更多」「校园」同一套做法。
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

	const path = $derived(page.url.pathname);

	function isActive(url: string): boolean {
		if (url === "/") return path === "/";
		return path.startsWith(url);
	}
</script>

<Sidebar.Root collapsible="icon">
	<Sidebar.Header>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton href="/" size="lg">
					<div
						class="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary font-heading text-sm font-semibold text-primary-foreground"
					>
						S
					</div>
					<div class="flex flex-col gap-0.5 leading-none group-data-[collapsible=icon]:hidden">
						<span class="font-heading text-base font-semibold tracking-tight">{data?.settings?.siteName || "Stelarith"}</span>
						<span class="text-xs text-muted-foreground">{data?.settings?.slogan || "Protect What You Love."}</span>
					</div>
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.Header>
	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.GroupLabel>工作区</Sidebar.GroupLabel>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					{#each workspace as item (item.url)}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton href={item.url} isActive={isActive(item.url)}>
								<item.icon />
								<span>{item.title}</span>
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
					{/each}
					<Sidebar.MenuItem>
						<Sidebar.MenuButton onclick={() => { moreOpen = !moreOpen; writeMoreOpen(moreOpen); }} aria-expanded={moreOpen} tooltipContent="更多">
							<MorphIcon icon={moreOpen ? ChevronUp : ChevronDown} spring="snappy" reducedMotion="user" size={16} aria-hidden="true" />
							<span class="group-data-[collapsible=icon]:hidden">更多</span>
						</Sidebar.MenuButton>
						{#if moreOpen}
							<Sidebar.MenuSub>
								{#each more as item (item.url)}
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
	<Sidebar.Separator />
	<Sidebar.Group>
		<Sidebar.GroupContent>
			<Sidebar.Menu>
				<Sidebar.MenuItem>
					<Sidebar.MenuButton onclick={() => { campusOpen = !campusOpen; writeCampusOpen(campusOpen); }} aria-expanded={campusOpen} tooltipContent="校园">
						<School />
						<span class="group-data-[collapsible=icon]:hidden">校园</span>
						<span class="ml-auto group-data-[collapsible=icon]:hidden"></span>
						<MorphIcon icon={campusOpen ? ChevronUp : ChevronDown} spring="snappy" reducedMotion="user" size={16} aria-hidden="true" />
					</Sidebar.MenuButton>
					{#if campusOpen}
						<Sidebar.MenuSub>
							{#each campusLinks as item (item.url)}
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
	<!-- 项目折叠组（2026-10-04）：星集控等独立项目收在这里，默认收起、
	     不占前台重点位置。与「校园」同构：展开/收起、权限门槛、图标解析。 -->
	{#if projectLinks.length > 0}
	<Sidebar.Separator />
	<Sidebar.Group>
		<Sidebar.GroupContent>
			<Sidebar.Menu>
				<Sidebar.MenuItem>
					<Sidebar.MenuButton onclick={toggleProject} aria-expanded={projectOpen} tooltipContent="项目">
						<Rocket />
						<span class="group-data-[collapsible=icon]:hidden">项目</span>
						<span class="ml-auto group-data-[collapsible=icon]:hidden"></span>
						<MorphIcon icon={projectOpen ? ChevronUp : ChevronDown} spring="snappy" reducedMotion="user" size={16} aria-hidden="true" />
					</Sidebar.MenuButton>
					{#if projectOpen}
						<Sidebar.MenuSub>
							{#each projectLinks as item (item.url)}
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
	<!-- 自定义组（镜像站等）：后台可增删。每种排列方式都包在 MenuSubItem(<li>) 里，
	     保证 ul>li 的 HTML 结构合法（grid 只改 MenuSub 的 display）。 -->
	{#each customGroups as g (g.key)}
	<Sidebar.Separator />
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
									{@const Icon = resolveIcon(item.icon, Globe)}
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
									{@const Icon = resolveIcon(item.icon, Globe)}
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
									{@const Icon = resolveIcon(item.icon, Globe)}
									<Sidebar.MenuSubItem>
										<Sidebar.MenuSubButton
											href={item.url}
											isActive={!item.external && isActive(item.url)}
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
	</Sidebar.Content>
	<!-- 前台底部固定栏（IA §2.5）：账户 + 反馈/公告/提示，要求「固定不随滚动丢失」。
	     原先这组挂在**可滚动的 Content 末尾**（工作区 8 项 + 更多 + 校园 + 自定义组一长就被滚出视野），
	     移入 Footer 后与「前后台切换」同处一个固定门面栏，与总纲 §2.3/§2.5 的 frontbar 一致。 -->
	<Sidebar.Footer>
	{#if authed}
	<Sidebar.Separator />
	<Sidebar.Group>
		<Sidebar.GroupContent>
			<Sidebar.Menu>
				{#each bottomLinks as item (item.url)}
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
	{:else}
	<Sidebar.Separator />
	<Sidebar.Group>
		<Sidebar.GroupContent>
			<Sidebar.Menu>
				<Sidebar.MenuItem>
					<Sidebar.MenuButton href="/admin/login" isActive={isActive("/admin/login")}>
						<LogIn />
						<span>登录</span>
					</Sidebar.MenuButton>
				</Sidebar.MenuItem>
			</Sidebar.Menu>
		</Sidebar.GroupContent>
	</Sidebar.Group>
	{/if}
		<div class="flex flex-wrap items-center gap-1 px-2 pb-2">
			{#each socials as s (s.name)}
				<a
					href={s.url}
					target="_blank"
					rel="noopener noreferrer"
					class="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
					aria-label={s.name}
				>
					<s.icon class="size-4" />
				</a>
			{/each}
		</div>
	</Sidebar.Footer>
	<Sidebar.Rail />
	<SidebarResizer />
</Sidebar.Root>