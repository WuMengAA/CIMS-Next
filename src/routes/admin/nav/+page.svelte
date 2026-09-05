<script lang="ts">
	import { onMount } from "svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Plus, Trash2, ArrowUp, ArrowDown, GripVertical, Save, LayoutList } from "@lucide/svelte";

	interface NavItem { title: string; url: string; icon?: string; }
	let groups = $state<{ key: "workspace" | "more" | "bottom"; label: string; items: NavItem[] }[]>([
		{ key: "workspace", label: "工作区（主要导航）", items: [] },
		{ key: "more", label: "更多（折叠菜单）", items: [] },
		{ key: "bottom", label: "底部导航", items: [] }
	]);
	let loading = $state(true);
	let saving = $state(false);
	let saved = $state(false);
	let error = $state("");

	// New item builder
	let newGroupKey = $state<"workspace" | "more" | "bottom">("workspace");
	let newTitle = $state("");
	let newUrl = $state("/");
	let newIcon = $state("");

	async function load() {
		loading = true;
		try {
			const res = await fetch("/api/nav");
			if (res.ok) {
				const nav = await res.json();
				groups = groups.map(g => ({ ...g, items: (nav[g.key] || []) as NavItem[] }));
			} else { error = "加载失败"; }
		} catch (e) { error = "网络错误"; }
		loading = false;
	}

	function addItem() {
		if (!newTitle.trim() || !newUrl.trim()) return;
		groups = groups.map(g => g.key === newGroupKey ? { ...g, items: [...g.items, { title: newTitle.trim(), url: newUrl.trim(), icon: newIcon.trim() || undefined }] } : g);
		newTitle = ""; newUrl = "/"; newIcon = "";
	}

	function removeItem(gkey: string, idx: number) {
		groups = groups.map(g => g.key === gkey ? { ...g, items: g.items.filter((_, i) => i !== idx) } : g);
	}

	function moveItem(gkey: string, idx: number, dir: number) {
		groups = groups.map(g => {
			if (g.key !== gkey) return g;
			const items = [...g.items];
			const target = idx + dir;
			if (target < 0 || target >= items.length) return g;
			[items[idx], items[target]] = [items[target], items[idx]];
			return { ...g, items };
		});
	}

	function updateItem(gkey: string, idx: number, field: string, value: string) {
		groups = groups.map(g => {
			if (g.key !== gkey) return g;
			const items = g.items.map((it, i) => i === idx ? { ...it, [field]: value } : it);
			return { ...g, items };
		});
	}

	async function save() {
		saving = true; saved = false;
		const payload: Record<string, NavItem[]> = {};
		for (const g of groups) payload[g.key] = g.items.filter(i => i.title && i.url);
		const res = await fetch("/api/nav", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload)
		});
		if (res.ok) { saved = true; setTimeout(() => (saved = false), 2500); }
		saving = false;
	}

	onMount(load);
</script>

<div class="mb-6 flex items-center justify-between">
	<div>
		<h1 class="text-2xl font-heading font-semibold">导航管理</h1>
		<p class="text-sm text-muted-foreground">配置侧边栏导航：排序、新增、编辑页面入口（保存后刷新前台生效）</p>
	</div>
	<Button onclick={save} disabled={saving}>
		<Save class="h-4 w-4 mr-2" />
		{saving ? "保存中..." : "保存导航"}
	</Button>
</div>

{#if error}
	<p class="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
{/if}
{#if saved}
	<p class="mb-4 rounded-md border border-border/60 bg-card p-3 text-sm">已保存，刷新前台即可看到新导航</p>
{/if}

<div class="mb-6 flex items-end gap-2 rounded-xl border border-border/60 bg-card p-4">
	<select bind:value={newGroupKey} class="h-9 rounded-md border bg-background px-3 text-sm">
		<option value="workspace">工作区</option>
		<option value="more">更多</option>
		<option value="bottom">底部</option>
	</select>
	<Input bind:value={newTitle} placeholder="名称（必填）" class="max-w-[200px]" />
	<Input bind:value={newUrl} placeholder="/路径" class="max-w-[200px]" />
	<Input bind:value={newIcon} placeholder="图标键(home/blog/…)" class="max-w-[180px]" />
	<Button onclick={addItem} disabled={!newTitle.trim() || !newUrl.trim()}>
		<Plus class="h-4 w-4 mr-1" /> 添加
	</Button>
</div>

{#if loading}
	<p class="text-muted-foreground">加载中...</p>
{:else}
	<div class="max-w-3xl space-y-6">
		{#each groups as group (group.key)}
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
					{#each group.items as item, i (group.key + i)}
						<div class="flex items-center gap-2 px-3 py-2">
							<GripVertical class="size-4 shrink-0 cursor-grab text-muted-foreground" />
							<Input bind:value={item.title} oninput={(e) => updateItem(group.key, i, "title", (e.target as HTMLInputElement).value)} placeholder="名称" class="h-8 max-w-[160px]" />
							<Input bind:value={item.url} oninput={(e) => updateItem(group.key, i, "url", (e.target as HTMLInputElement).value)} placeholder="/路径" class="h-8 flex-1" />
							<Button variant="ghost" size="icon" class="h-8 w-8" onclick={() => moveItem(group.key, i, -1)} disabled={i === 0}><ArrowUp class="h-3.5 w-3.5" /></Button>
							<Button variant="ghost" size="icon" class="h-8 w-8" onclick={() => moveItem(group.key, i, 1)} disabled={i === group.items.length - 1}><ArrowDown class="h-3.5 w-3.5" /></Button>
							<Button variant="ghost" size="icon" class="h-8 w-8 text-destructive hover:text-destructive" onclick={() => removeItem(group.key, i)}><Trash2 class="h-3.5 w-3.5" /></Button>
						</div>
					{/each}
				</div>
			</section>
		{/each}
	</div>
{/if}