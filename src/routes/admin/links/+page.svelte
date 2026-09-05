<script lang="ts">
	import { onMount } from "svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Save, Plus, Trash2, Link2 } from "@lucide/svelte";

	interface Link { name: string; url: string; description?: string; }
	let links = $state<Link[]>([]);
	let loading = $state(true);
	let saving = $state(false);
	let saved = $state(false);

	async function load() {
		loading = true;
		try {
			const res = await fetch("/api/links");
			if (res.ok) links = await res.json();
		} catch (e) { console.error(e); }
		loading = false;
	}

	function addLink() {
		links = [...links, { name: "", url: "", description: "" }];
	}

	function removeLink(index: number) {
		links = links.filter((_, i) => i !== index);
	}

	async function save() {
		saving = true;
		saved = false;
		try {
			const clean = links.filter(l => l.name && l.url);
			const res = await fetch("/api/links", {
				method: "POST",
				headers: { "Content-Type": "application/json", "x-action": "save" },
				body: JSON.stringify({ links: clean })
			});
			if (res.ok) {
				links = clean;
				saved = true;
				setTimeout(() => { saved = false; }, 3000);
			}
		} catch (e) { console.error(e); }
		saving = false;
	}

	onMount(load);
</script>

<div class="mb-6 flex items-center justify-between">
	<div>
		<h1 class="text-2xl font-heading font-semibold">友情链接</h1>
		<p class="text-sm text-muted-foreground">管理首页与连接页展示的友链</p>
	</div>
	<Button onclick={addLink} variant="outline">
		<Plus class="h-4 w-4 mr-2" />
		添加友链
	</Button>
</div>

{#if loading}
	<p class="text-muted-foreground">加载中...</p>
{:else}
	<div class="max-w-2xl space-y-3">
		{#each links as link, i (i)}
			<div class="rounded-lg border p-4">
				<div class="grid grid-cols-2 gap-3">
					<div class="grid gap-1.5">
						<Label>名称</Label>
						<Input bind:value={link.name} placeholder="站点名称" />
					</div>
					<div class="grid gap-1.5">
						<Label>网址</Label>
						<Input bind:value={link.url} placeholder="https://..." />
					</div>
				</div>
				<div class="mt-3 flex items-center gap-2">
					<div class="grid flex-1 gap-1.5">
						<Label>描述（可选）</Label>
						<Input bind:value={link.description} placeholder="一句话介绍" />
					</div>
					<Button variant="ghost" size="icon" class="mt-5 h-9 w-9 text-destructive hover:text-destructive" onclick={() => removeLink(i)}>
						<Trash2 class="h-4 w-4" />
					</Button>
				</div>
			</div>
		{/each}
		{#if links.length === 0}
			<div class="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center text-muted-foreground">
				<Link2 class="size-6" />
				<p class="text-sm">暂无友链，点击"添加友链"开始</p>
			</div>
		{/if}
		<div class="flex items-center gap-3 pt-2">
			<Button onclick={save} disabled={saving}>
				<Save class="h-4 w-4 mr-2" />
				{saving ? "保存中..." : "保存友链"}
			</Button>
			{#if saved}
				<Badge variant="secondary">已保存</Badge>
			{/if}
		</div>
	</div>
{/if}