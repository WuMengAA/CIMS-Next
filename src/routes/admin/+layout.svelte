<script lang="ts">
	import type { Snippet } from "svelte";
	import * as Sidebar from "$lib/components/ui/sidebar/index.js";
	import { page } from "$app/state";
	import ConfirmHost from "$lib/components/admin/confirm-host.svelte";
	import { LayoutDashboard, BookOpen, Rocket, BookMarked, Image, Link, Globe, ExternalLink, Settings, UsersRound, Inbox, LayoutList } from "@lucide/svelte";

	let { children }: { children?: Snippet } = $props();

	const nav = [
		{ title: "仪表盘", url: "/admin", icon: LayoutDashboard },
		{ title: "博客文章", url: "/admin/posts", icon: BookOpen },
		{ title: "项目管理", url: "/admin/projects", icon: Rocket },
		{ title: "文档资料", url: "/admin/docs", icon: BookMarked },
		{ title: "媒体库", url: "/admin/media", icon: Image },
		{ title: "友情链接", url: "/admin/links", icon: Link },
		{ title: "友链申请", url: "/admin/link-applications", icon: Inbox },
		{ title: "导航管理", url: "/admin/nav", icon: LayoutList },
		{ title: "用户管理", url: "/admin/users", icon: UsersRound },
		{ title: "站点设置", url: "/admin/settings", icon: Settings }
	];

	const currentPath = $derived(page.url.pathname);

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

<Sidebar.Root class="bg-sidebar text-sidebar-foreground">
	<ConfirmHost />
	<Sidebar.Header>
		<a href="/" class="flex items-center gap-3">
			<div class="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary font-heading text-sm font-bold text-primary-foreground">AF</div>
			<div class="flex flex-col gap-0.5 leading-none">
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
						<Sidebar.MenuButton href={item.url} isActive={isActive(item.url)}>
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
		<div class="flex items-center justify-between px-3">
			<p class="text-xs text-muted-foreground">Stelarith CMS</p>
			<button onclick={logout} class="text-xs text-muted-foreground hover:text-destructive">退出登录</button>
		</div>
	</Sidebar.Footer>
</Sidebar.Root>

<Sidebar.Inset>
	<Sidebar.Header class="border-b border-border px-6">
		<div class="flex items-center justify-between">
			<h2 class="text-lg font-heading font-semibold">管理后台</h2>
			<a href="/" target="_blank" class="text-xs text-muted-foreground hover:text-foreground">查看前台</a>
		</div>
	</Sidebar.Header>
	<Sidebar.Content class="p-6">
		{@render children()}
	</Sidebar.Content>
</Sidebar.Inset>
