<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import { Plus } from "@lucide/svelte";
	import SortableList from "$lib/components/admin/sortable-list.svelte";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	// 初始数据来自 load（导航期已取回）；增删后手动调 loadPages() 刷新
	let pages = $state<any[]>(data.pages);

	async function loadPages() {
		try {
			const res = await fetch("/api/pages");
			if (res.ok) pages = (await res.json()) as any[];
		} catch (e) {
			console.error(e);
		}
	}

	async function handleReorder(ordered: string[]) {
		await fetch("/api/pages", {
			method: "POST",
			headers: { "Content-Type": "application/json", "x-action": "reorder" },
			body: JSON.stringify({ orderedSlugs: ordered })
		});
	}
</script>

<div class="mb-6 flex items-center justify-between">
	<div>
		<h1 class="text-2xl font-heading font-semibold">页面管理</h1>
		<p class="text-sm text-muted-foreground">独立页面（关于页、自定义落地页等）· 拖动或按钮调整排序</p>
	</div>
	<Button href="/admin/pages/new"><Plus class="h-4 w-4 mr-2" /> 新建页面</Button>
</div>

{#if pages.length === 0}
	<div class="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
		<p>暂无页面</p>
		<a href="/admin/pages/new" class="text-primary hover:underline">创建第一个页面</a>
	</div>
{:else}
	<SortableList
		items={pages}
		section="pages"
		editBase="/admin/pages"
		viewBase="/pages"
		onReorder={handleReorder}
	/>
{/if}

<div class="mt-8 flex items-start gap-2 rounded-lg border border-border/60 p-4 text-xs text-muted-foreground">
	<p>页面是独立的可访问内容（前台路径 /pages/&lt;slug&gt;），适合放置「关于」「友链说明」等无固定分类的内容。可在编辑器中直接编写 Markdown。</p>
</div>
