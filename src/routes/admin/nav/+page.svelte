<script lang="ts">
	import { onMount } from "svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import IconPicker from "$lib/components/icon-picker.svelte";
	import { confirmDelete } from "$lib/components/admin/confirm.svelte";
	import { Plus, Trash2, ArrowUp, ArrowDown, GripVertical, Save, LayoutList, Layers, ExternalLink } from "@lucide/svelte";

	type NavItem = { title: string; url: string; icon?: string; external?: boolean };
	type Layout = "list" | "grid" | "inline";
	type ShowIn = "site" | "admin" | "both";
	type CustomGroup = {
		key: string;
		label: string;
		icon?: string;
		layout: Layout;
		collapsed: boolean;
		showIn: ShowIn;
		items: NavItem[];
	};

	const emptyDraft = (): NavItem => ({ title: "", url: "", icon: "", external: false });

	// 固定三组表达「位置」（工作区 / 更多 / 底部），是历史结构，保持不变。
	let fixed = $state<{ key: "workspace" | "more" | "bottom"; label: string; items: NavItem[] }[]>([
		{ key: "workspace", label: "工作区（主要导航）", items: [] },
		{ key: "more", label: "更多（折叠菜单）", items: [] },
		{ key: "bottom", label: "底部导航", items: [] }
	]);

	// 自定义组表达「归属」（镜像站等），可增删、可换排列方式与出现范围。
	let customGroups = $state<CustomGroup[]>([]);

	// 各组「添加条目」的草稿输入，按 group.key 分桶。之所以不放在组对象里：
	// 组对象会被序列化进导航数据，草稿（敲到一半的内容）不该被保存进去。
	let drafts = $state<Record<string, NavItem>>({
		workspace: emptyDraft(),
		more: emptyDraft(),
		bottom: emptyDraft()
	});

	let loading = $state(true);
	let saving = $state(false);
	let saved = $state(false);
	let error = $state("");

	const SELECT_CLS =
		"h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-primary/60";

	function ensureDraft(key: string) {
		if (!drafts[key]) drafts[key] = emptyDraft();
	}

	async function load() {
		loading = true;
		try {
			const res = await fetch("/api/nav");
			if (res.ok) {
				const nav = await res.json();
				fixed = fixed.map((g) => ({ ...g, items: (nav[g.key] || []) as NavItem[] }));
				customGroups = (Array.isArray(nav.groups) ? nav.groups : []).map((g: Partial<CustomGroup>) => ({
					key: String(g.key || ""),
					label: String(g.label || ""),
					icon: g.icon || "",
					layout: (g.layout || "list") as Layout,
					collapsed: g.collapsed === true,
					showIn: (g.showIn || "both") as ShowIn,
					items: (g.items || []) as NavItem[]
				}));
				// 草稿必须与组同时就绪：模板里按 key 直取，缺了会 bind 到 undefined。
				for (const g of [...fixed, ...customGroups]) ensureDraft(g.key);
			} else {
				error = "加载失败";
			}
		} catch (e) {
			error = "网络错误";
		}
		loading = false;
	}

	/** 生成不重复的组标识。用 group-N 而不是让用户先想英文名：标识只服务于折叠记忆。 */
	function genKey(): string {
		const used = new Set(customGroups.map((g) => g.key));
		let n = 1;
		while (used.has(`group-${n}`)) n++;
		return `group-${n}`;
	}

	function addGroup() {
		const key = genKey();
		customGroups = [
			...customGroups,
			{ key, label: "新建分组", icon: "globe", layout: "grid", collapsed: false, showIn: "both", items: [] }
		];
		ensureDraft(key);
	}

	async function removeGroup(index: number) {
		const g = customGroups[index];
		const extra = g.items.length ? `该组内 ${g.items.length} 个条目会一并移除。` : "";
		if (!(await confirmDelete(`删除分组「${g.label}」`, `保存后才会生效。${extra}此操作不可恢复。`))) return;
		customGroups = customGroups.filter((_, i) => i !== index);
	}

	function move(list: NavItem[], i: number, dir: number) {
		const t = i + dir;
		if (t < 0 || t >= list.length) return;
		const tmp = list[i];
		list[i] = list[t];
		list[t] = tmp;
	}

	function addItemTo(group: { key: string; items: NavItem[] }, allowExternal: boolean) {
		const d = drafts[group.key];
		if (!d || !d.title.trim() || !d.url.trim()) return;
		group.items.push({
			title: d.title.trim(),
			url: d.url.trim(),
			...(d.icon ? { icon: d.icon } : {}),
			...(allowExternal && d.external ? { external: true } : {})
		});
		drafts[group.key] = emptyDraft();
	}

	async function save() {
		saving = true;
		saved = false;
		error = "";
		const payload: Record<string, unknown> = {
			workspace: fixed[0].items.filter((i) => i.title && i.url),
			more: fixed[1].items.filter((i) => i.title && i.url),
			bottom: fixed[2].items.filter((i) => i.title && i.url),
			groups: customGroups.map((g) => ({
				key: g.key,
				label: g.label,
				icon: g.icon || undefined,
				layout: g.layout,
				collapsed: g.collapsed,
				showIn: g.showIn,
				items: g.items.filter((i) => i.title && i.url)
			}))
		};
		const res = await fetch("/api/nav", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload)
		});
		if (res.ok) {
			saved = true;
			setTimeout(() => (saved = false), 2500);
		} else {
			error = res.status === 403 ? "权限不足（需要编辑及以上）" : "保存失败";
		}
		saving = false;
	}

	onMount(load);
</script>

<!-- 条目行：固定组与自定义组共用（自定义组多一个「外链」开关）。
     key 用「组标识 + 序号」而不是条目对象：交换顺序时 DOM 不移动、只更新绑定值，
     bind:value={list[i].x} 的指向始终是同一个索引，行为最可预测。 -->
{#snippet itemRow(list: NavItem[], i: number, allowExternal: boolean)}
	<div class="flex flex-wrap items-center gap-2 px-3 py-2">
		<GripVertical class="size-4 shrink-0 cursor-grab text-muted-foreground" />
		<Input bind:value={list[i].title} placeholder="名称" class="h-8 w-[150px] max-w-none" />
		<Input bind:value={list[i].url} placeholder="/路径 或 https://…" class="h-8 min-w-[120px] max-w-none flex-1" />
		<IconPicker value={list[i].icon || ""} onpick={(n) => (list[i].icon = n)} triggerLabel="图标" />
		{#if allowExternal}
			<label class="flex shrink-0 items-center gap-1 text-xs text-muted-foreground" title="在新标签页打开">
				<input type="checkbox" bind:checked={list[i].external} />
				<ExternalLink class="size-3.5" /> 外链
			</label>
		{/if}
		<Button variant="ghost" size="icon" class="h-8 w-8" onclick={() => move(list, i, -1)} disabled={i === 0}
			><ArrowUp class="h-3.5 w-3.5" /></Button
		>
		<Button variant="ghost" size="icon" class="h-8 w-8" onclick={() => move(list, i, 1)} disabled={i === list.length - 1}
			><ArrowDown class="h-3.5 w-3.5" /></Button
		>
		<Button variant="ghost" size="icon" class="h-8 w-8 text-destructive hover:text-destructive" onclick={() => list.splice(i, 1)}
			><Trash2 class="h-3.5 w-3.5" /></Button
		>
	</div>
{/snippet}

<!-- 添加条目行：草稿输入 + 落到指定组 -->
{#snippet addRow(group: { key: string; items: NavItem[] }, allowExternal: boolean)}
	{@const d = drafts[group.key] ?? emptyDraft()}
	<div class="flex flex-wrap items-center gap-2 border-t border-border/40 bg-muted/20 px-3 py-2">
		<Input bind:value={d.title} placeholder="名称（必填）" class="h-8 w-[150px] max-w-none" />
		<Input
			bind:value={d.url}
			placeholder="/路径 或 https://…"
			class="h-8 min-w-[120px] max-w-none flex-1 sm:max-w-[240px]"
		/>
		<IconPicker value={d.icon || ""} onpick={(n) => (d.icon = n)} triggerLabel="图标" />
		{#if allowExternal}
			<label class="flex shrink-0 items-center gap-1 text-xs text-muted-foreground" title="在新标签页打开">
				<input type="checkbox" bind:checked={d.external} />
				<ExternalLink class="size-3.5" /> 外链
			</label>
		{/if}
		<Button onclick={() => addItemTo(group, allowExternal)} disabled={!d.title.trim() || !d.url.trim()}>
			<Plus class="mr-1 h-4 w-4" /> 添加
		</Button>
	</div>
{/snippet}

<div class="mb-6 flex items-center justify-between">
	<div>
		<h1 class="text-2xl font-heading font-semibold">导航管理</h1>
		<p class="text-sm text-muted-foreground">
			配置侧边栏：固定三组（工作区/更多/底部）+ 自定义分组（如「镜像站」）。保存后刷新前台生效。
		</p>
	</div>
	<Button onclick={save} disabled={saving}>
		<Save class="mr-2 h-4 w-4" />
		{saving ? "保存中..." : "保存导航"}
	</Button>
</div>

{#if error}
	<p class="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
{/if}
{#if saved}
	<p class="mb-4 rounded-md border border-border/60 bg-card p-3 text-sm">已保存，刷新前台即可看到新导航</p>
{/if}

{#if loading}
	<p class="text-muted-foreground">加载中...</p>
{:else}
	<div class="max-w-3xl space-y-6">
		<!-- ── 固定三组 ───────────────────────────────────────────────── -->
		{#each fixed as group (group.key)}
			<section class="rounded-xl border border-border/60 bg-card">
				<header class="flex items-center gap-2 border-b border-border/40 px-4 py-3">
					<LayoutList class="size-4 text-primary" />
					<h2 class="font-heading font-medium">{group.label}</h2>
					<Badge variant="outline" class="ml-auto">{group.items.length}</Badge>
				</header>
				<div class="flex flex-col divide-y divide-border/40">
					{#if group.items.length === 0}
						<p class="px-4 py-4 text-sm text-muted-foreground">暂无项目</p>
					{/if}
					{#each group.items as _item, i (group.key + i)}
						{@render itemRow(group.items, i, false)}
					{/each}
				</div>
				{@render addRow(group, false)}
			</section>
		{/each}

		<!-- ── 自定义分组 ─────────────────────────────────────────────── -->
		<div class="flex items-center gap-2 pt-2">
			<Layers class="size-4 text-primary" />
			<h2 class="font-heading text-lg font-semibold">自定义分组</h2>
			<Button variant="outline" size="sm" class="ml-auto" onclick={addGroup}>
				<Plus class="mr-1 h-3.5 w-3.5" /> 新建分组
			</Button>
		</div>

		{#if customGroups.length === 0}
			<p class="rounded-xl border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
				还没有自定义分组。可以用它放「镜像站」「我的其他站点」这类成组入口 —— 组内条目支持单列、两列格子、一行图标三种排列，
				也可以设置成只在后台侧栏显示。
			</p>
		{/if}

		{#each customGroups as g, gi (g.key)}
			<section class="rounded-xl border border-border/60 bg-card">
				<header class="flex flex-wrap items-center gap-2 border-b border-border/40 px-3 py-3">
					<IconPicker value={g.icon || ""} onpick={(n) => (g.icon = n)} triggerLabel="组图标" size={16} />
					<Input bind:value={g.label} placeholder="分组名称" class="h-8 w-[140px] max-w-none" />
					<select bind:value={g.layout} class={SELECT_CLS} title="组内条目的排列方式">
						<option value="list">单列</option>
						<option value="grid">两列格子</option>
						<option value="inline">一行图标</option>
					</select>
					<select bind:value={g.showIn} class={SELECT_CLS} title="这个分组出现在哪里">
						<option value="both">前台 + 后台</option>
						<option value="site">仅前台</option>
						<option value="admin">仅后台</option>
					</select>
					<label class="flex items-center gap-1 text-xs text-muted-foreground" title="进入页面时默认收起">
						<input type="checkbox" bind:checked={g.collapsed} /> 默认折叠
					</label>
					<Badge variant="outline" class="ml-auto">{g.items.length}</Badge>
					<Button
						variant="ghost"
						size="icon"
						class="h-8 w-8 text-destructive hover:text-destructive"
						title="删除分组"
						onclick={() => removeGroup(gi)}><Trash2 class="h-3.5 w-3.5" /></Button
					>
				</header>
				<div class="flex items-center gap-2 border-b border-border/40 px-3 py-1.5 text-[11px] text-muted-foreground">
					<span class="shrink-0">标识</span>
					<Input bind:value={g.key} class="h-7 w-[130px] max-w-none font-mono text-[11px]" />
					<span class="truncate">仅小写字母/数字/连字符，用于记住这个组的展开状态</span>
				</div>
				<div class="flex flex-col divide-y divide-border/40">
					{#if g.items.length === 0}
						<p class="px-4 py-4 text-sm text-muted-foreground">暂无项目</p>
					{/if}
					{#each g.items as _item, i (g.key + i)}
						{@render itemRow(g.items, i, true)}
					{/each}
				</div>
				{@render addRow(g, true)}
			</section>
		{/each}
	</div>
{/if}
