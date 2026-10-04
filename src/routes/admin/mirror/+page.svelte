<script lang="ts">
	/**
	 * 镜像站总览（后台「设置」模块）。
	 *
	 * 背景：侧栏 NAV 里早有「镜像站 → /admin/mirror」这一条，但**从来就没有这个页面**
	 * （git 历史里也没有），点进去只会 404。镜像线路本身是 nav.json 的 `groups` 自定义分组
	 * （key = "mirrors"），由「导航管理」维护、并已在前台/后台侧栏各自成组渲染。
	 *
	 * 这里不再另造一套镜像数据（那只会与导航分组打架），而是把**已有的那一组**集中展示出来：
	 * 一眼看清主站与各条线路指向哪、点开即走。要增删改仍回「导航管理」，
	 * 保证镜像数据只有 nav.json 一个真源，不产生第二份会漂移的副本。
	 */
	import { onMount } from "svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { ICON_MAP } from "$lib/icon-library.js";
	import { Globe, ExternalLink, Pencil } from "@lucide/svelte";

	type NavItem = { title: string; url: string; icon?: string; external?: boolean };
	type NavGroup = {
		key: string;
		label: string;
		icon?: string;
		layout?: string;
		showIn?: string;
		items: NavItem[];
	};

	let loading = $state(true);
	let error = $state("");
	let group = $state<NavGroup | null>(null);

	async function load() {
		loading = true;
		error = "";
		try {
			const res = await fetch("/api/nav");
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const nav = await res.json();
			const groups: NavGroup[] = Array.isArray(nav?.groups) ? nav.groups : [];
			group = groups.find((g) => g.key === "mirrors") ?? null;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
		loading = false;
	}

	onMount(load);

	function iconOf(name?: string) {
		return (name && ICON_MAP[name]) || Globe;
	}

	const LAYOUT_LABEL: Record<string, string> = { list: "单列", grid: "两列格子", inline: "一行图标" };
	const SHOWIN_LABEL: Record<string, string> = { site: "仅前台", admin: "仅后台", both: "前后台都显示" };
</script>

<div class="mb-6 flex flex-wrap items-start justify-between gap-3">
	<div>
		<h1 class="text-2xl font-heading font-semibold">镜像站</h1>
		<p class="text-sm text-muted-foreground">
			主站与各条镜像线路一览。这一组由「导航管理」维护，此处集中查看，点开即走。
		</p>
	</div>
	<a href="/admin/nav">
		<Button variant="outline">
			<Pencil class="h-4 w-4 mr-2" />
			去导航管理修改
		</Button>
	</a>
</div>

{#if loading}
	<p class="text-muted-foreground">加载中...</p>
{:else if error}
	<div class="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
		读取导航配置失败：{error}
		<button class="ml-2 underline" onclick={load}>重试</button>
	</div>
{:else if !group}
	<div class="flex flex-col items-start gap-3 rounded-lg border border-dashed p-8 text-muted-foreground">
		<Globe class="size-6" />
		<p class="text-sm">还没有「镜像站」分组。</p>
		<p class="text-xs leading-relaxed">
			到「导航管理 → 自定义分组」新建一个 key 为 <code class="rounded bg-muted px-1 py-0.5">mirrors</code> 的分组，
			把各条镜像线路加进去；这里会自动显示，前台与后台侧栏也会同步出现这一组。
		</p>
		<a href="/admin/nav"><Button variant="secondary" size="sm">去新建分组</Button></a>
	</div>
{:else}
	<div class="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
		<Badge variant="secondary">{group.label}</Badge>
		<span>排列：{LAYOUT_LABEL[group.layout ?? "list"] ?? group.layout}</span>
		<span>·</span>
		<span>{SHOWIN_LABEL[group.showIn ?? "both"] ?? group.showIn}</span>
		<span>·</span>
		<span>{group.items.length} 条线路</span>
	</div>

	{#if group.items.length === 0}
		<div class="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
			这个分组还没有线路。去「导航管理」往 mirrors 分组里添加。
		</div>
	{:else}
		<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{#each group.items as item (item.url)}
				{@const Icon = iconOf(item.icon)}
				<a
					href={item.url}
					target="_blank"
					rel="noopener noreferrer"
					class="group flex items-center gap-3 rounded-lg border p-4 transition-colors hover:border-primary/50"
				>
					<span class="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-primary">
						<Icon class="size-4" />
					</span>
					<span class="min-w-0 flex-1">
						<span class="block truncate font-medium">{item.title}</span>
						<span class="block truncate text-xs text-muted-foreground">{item.url}</span>
					</span>
					<ExternalLink class="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
				</a>
			{/each}
		</div>
	{/if}

	<p class="mt-6 text-xs text-muted-foreground">
		前台与后台侧栏里的「{group.label}」分组与本页同源（<code class="rounded bg-muted px-1 py-0.5">content/nav.json</code>），
		改动一处两处同步。
	</p>
{/if}
