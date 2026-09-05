<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import { Plus, Trash2, BookMarked } from "@lucide/svelte";
	import SortableList from "$lib/components/admin/sortable-list.svelte";
	import { toast } from "svelte-sonner";
	import { confirmDelete } from "$lib/components/admin/confirm.svelte";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	// 初始数据来自 load（导航期已取回），folderFilter 转为派生过滤，不再整页重取
	let docs = $state<any[]>(data.docs);
	let folders = $state<string[]>(data.folders);
	let folderFilter = $state("");

	const visibleDocs = $derived(
		folderFilter ? docs.filter((d: any) => d.folder === folderFilter) : docs
	);

	async function loadDocs() {
		try {
			const [fRes, dRes] = await Promise.all([
				fetch("/api/docs?action=folders"),
				fetch("/api/docs")
			]);
			if (fRes.ok) { const fd = await fRes.json(); folders = Array.isArray(fd) ? fd : []; }
			if (dRes.ok) docs = (await dRes.json()) as any[];
		} catch (e) {
			console.error(e);
		}
	}

	async function handleDelete(slug: string) {
		if (!(await confirmDelete("删除文档", "文档将永久删除，此操作不可恢复。"))) return;
		fetch("/api/docs", {
			method: "POST",
			headers: { "Content-Type": "application/json", "x-action": "delete" },
			body: JSON.stringify({ slug })
		}).then(async (res) => {
			if (res.ok) {
				loadDocs();
			} else {
				const d = await res.json().catch(() => ({}));
				toast.error(d.error || "删除失败，请重新登录后再试");
			}
		});
	}

	async function handleReorder(ordered: string[]) {
		await fetch("/api/docs", {
			method: "POST",
			headers: { "Content-Type": "application/json", "x-action": "reorder" },
			body: JSON.stringify({ orderedSlugs: ordered })
		});
	}

	// 初始数据来自 load；增删后手动调 loadDocs() 刷新
</script>

<div class="mb-6 flex items-center justify-between">
	<div>
		<h1 class="text-2xl font-heading font-semibold">文档资料</h1>
		<p class="text-sm text-muted-foreground">Wiki 模式文档库 · 拖动或按钮调整排序</p>
	</div>
	<div class="flex items-center gap-2">
		<select bind:value={folderFilter} class="h-9 rounded-md border bg-background px-3 text-sm">
			<option value="">全部文件夹</option>
			{#each folders as f (f)}<option value={f}>{f}</option>{/each}
		</select>
		<Button href="/admin/docs/new?folder=新建文件夹"><Plus class="h-4 w-4 mr-2" /> 新建文件夹</Button>
		<Button href="/admin/docs/new"><Plus class="h-4 w-4 mr-2" /> 新建文档</Button>
	</div>
</div>

{#if visibleDocs.length === 0}
	<div class="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
		<p>暂无文档</p>
		<a href="/admin/docs/new" class="text-primary hover:underline">创建第一篇文档</a>
	</div>
{:else}
	<SortableList
		items={visibleDocs}
		section="docs"
		editBase="/admin/docs"
		viewBase="/docs"
		onReorder={handleReorder}
	/>
{/if}

<div class="mt-8 flex items-start gap-2 rounded-lg border border-border/60 p-4 text-xs text-muted-foreground">
	<BookMarked class="mt-0.5 h-4 w-4 shrink-0" />
	<p>文档采用 Wiki 模式：前台页面左侧展示全部文档的目录树，点击切换内容。可在编辑器中直接编写 Markdown。</p>
</div>