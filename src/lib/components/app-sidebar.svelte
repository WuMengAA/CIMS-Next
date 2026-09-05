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
		Globe
	} from "@lucide/svelte";
	import { Github, Twitter } from "$lib/components/icons/index.js";
	import { MorphIcon } from "morphicons/svelte";
	import { ChevronDown, ChevronUp } from "lucide";
	
	import { page } from "$app/state";

	let { data }: { data?: { settings?: { socials?: { name: string; url: string }[]; siteName?: string; slogan?: string }; nav?: { workspace: { title: string; url: string; icon?: string }[]; more: { title: string; url: string; icon?: string }[]; bottom: { title: string; url: string; icon?: string }[] } } } = $props();

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
	const defaultWorkspace = [
		{ title: "首页", url: "/", icon: "home" },
		{ title: "博客", url: "/posts", icon: "blog" },
		{ title: "项目", url: "/projects", icon: "projects" },
		{ title: "文档", url: "/docs", icon: "docs" },
		{ title: "AI 绘图", url: "/create", icon: "create" },
		{ title: "交互小说", url: "/novels", icon: "novels" },
		{ title: "追番", url: "/anime", icon: "anime" },
		{ title: "游戏", url: "/games", icon: "games" },
		{ title: "工具集", url: "/tools", icon: "tools" }
	];
	const defaultMore = [
		{ title: "公告", url: "/announcements", icon: "announcements" },
		{ title: "连接", url: "/links", icon: "links" },
		{ title: "旧站归档", url: "/archives", icon: "archives" },
		{ title: "反馈", url: "/feedback", icon: "feedback" }
	];
	const defaultBottom = [
		{ title: "管理后台", url: "/admin", icon: "admin" },
		{ title: "钱包", url: "/wallet", icon: "wallet" },
		{ title: "账号", url: "/account", icon: "account" }
	];

	const navIconMap: Record<string, any> = {
		"home": Home, "blog": BookOpen, "posts": BookOpen, "bookopen": BookOpen,
		"project": Rocket, "projects": Rocket, "rocket": Rocket, "doc": BookMarked, "docs": BookMarked, "bookmarked": BookMarked,
		"create": Sparkles, "sparkles": Sparkles, "novel": BookMarked, "novels": BookMarked, "anime": Clapperboard, "clapperboard": Clapperboard,
		"game": Gamepad2, "games": Gamepad2, "gamepad2": Gamepad2, "tool": Wrench, "tools": Wrench, "wrench": Wrench,
		"announcement": Megaphone, "announcements": Megaphone, "megaphone": Megaphone, "link": Link, "links": Link,
		"archive": Archive, "archives": Archive, "archive": Archive, "feedback": MessageSquare, "messagesquare": MessageSquare,
		"admin": Wrench, "wallet": Wallet, "user": User, "account": User, "users": User
	};

	const workspace = $derived(
		(data?.nav?.workspace && data.nav.workspace.length > 0 ? data.nav.workspace : defaultWorkspace)
			.map(i => ({ ...i, icon: navIconMap[(i.icon || i.title).toLowerCase()] || Home }))
	);
	const more = $derived(
		(data?.nav?.more && data.nav.more.length > 0 ? data.nav.more : defaultMore)
			.map(i => ({ ...i, icon: navIconMap[(i.icon || i.title).toLowerCase()] || Globe }))
	);
	const bottom = $derived(
		(data?.nav?.bottom && data.nav.bottom.length > 0 ? data.nav.bottom : defaultBottom)
			.map(i => ({ ...i, icon: navIconMap[(i.icon || i.title).toLowerCase()] || Globe }))
	);

	let moreOpen = $state(false);
	// 管理类入口（后台/钱包/账号）仅登录用户可见：SSR 默认隐藏，
	// 客户端校验通过后才渲染，游客全程看不到后台入口。
	let authed = $state(false);
	$effect(() => {
		fetch("/api/auth").then((r) => { if (r.ok) authed = true; }).catch(() => {});
	});

	const path = $derived(page.url.pathname);

	function isActive(url: string): boolean {
		if (url === "/") return path === "/" || path === "";
		return path.startsWith(url);
	}
</script>

<Sidebar.Root>
	<Sidebar.Header>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton href="/" size="lg">
					<div
						class="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary font-heading text-sm font-bold text-primary-foreground"
					>
						AF
					</div>
					<div class="flex flex-col gap-0.5 leading-none">
						<span class="font-heading text-base font-semibold tracking-tight">{data?.settings?.siteName || "Stelarith 工作台"}</span>
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
						<Sidebar.MenuButton onclick={() => (moreOpen = !moreOpen)}>
							<MorphIcon icon={moreOpen ? ChevronUp : ChevronDown} spring="snappy" reducedMotion="user" size={16} aria-hidden="true" />
							<span>更多</span>
						</Sidebar.MenuButton>
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
					</Sidebar.MenuItem>
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>
		{#if authed}
		<Sidebar.Separator />
		<Sidebar.Group>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					{#each bottom as item (item.url)}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton href={item.url} isActive={isActive(item.url)}>
								<item.icon />
								<span>{item.title}</span>
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
					{/each}
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>
		{/if}
	</Sidebar.Content>
	<Sidebar.Footer>
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
</Sidebar.Root>