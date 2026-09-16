<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import { Plus, Trash2 } from "@lucide/svelte";
	import SortableList from "$lib/components/admin/sortable-list.svelte";
	import { toast } from "svelte-sonner";
	import { confirmDelete } from "$lib/components/admin/confirm.svelte";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	// 初始数据来自 load（导航期已取回），删除/排序后仍走手动刷新
	let projects = $state<any[]>(data.projects);

	async function loadProjects() {
		try {
			projects = (await (await fetch("/api/projects")).json()) as any[];
		} catch (e) {
			console.error(e);
		}
	}

	async function handleDelete(slug: string) {
		if (!(await confirmDelete("删除项目", "项目将永久删除，此操作不可恢复。"))) return;
		fetch("/api/projects", {
			method: "POST",
			headers: { "Content-Type": "application/json", "x-action": "delete" },
			body: JSON.stringify({ slug })
		}).then(async (res) => {
			if (res.ok) {
				loadProjects();
			} else {
				const d = await res.json().catch(() => ({}));
				toast.error(d.error || "删除失败，请重新登录后再试");
			}
		});
	}

	async function handleReorder(ordered: string[]) {
		await fetch("/api/projects", {
			method: "POST",
			headers: { "Content-Type": "application/json", "x-action": "reorder" },
			body: JSON.stringify({ orderedSlugs: ordered })
		});
	}

	// 数据来自 load，不再需要 onMount 首载
</script>

<div class="mb-6 flex items-center justify-between">
	<div>
		<h1 class="text-2xl font-heading font-semibold">项目管理</h1>
		<p class="text-sm text-muted-foreground">管理个人项目 · 拖动或按钮调整排序</p>
	</div>
	<Button href="/admin/projects/new">
		<Plus class="h-4 w-4 mr-2" />
		新建项目
	</Button>
</div>

{#if projects.length === 0}
	<div class="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
		<p>暂无项目</p>
		<a href="/admin/projects/new" class="text-primary hover:underline">创建第一个项目</a>
	</div>
{:else}
	<div class="space-y-2">
		{#each projects as project (project.slug)}
			<div class="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent/40">
				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-2">
						<span class="truncate font-medium">{project.title}</span>
						{#if project.category}
							<span class="rounded bg-accent px-1.5 py-0.5 text-xs text-muted-foreground">{project.category}</span>
						{/if}
					</div>
					{#if project.excerpt}
						<p class="line-clamp-1 text-xs text-muted-foreground">{project.excerpt}</p>
					{/if}
				</div>
				<Button variant="ghost" size="icon" class="h-8 w-8 text-destructive hover:text-destructive" onclick={() => handleDelete(project.slug)}>
					<Trash2 class="h-4 w-4" />
				</Button>
			</div>
		{/each}
	</div>
{/if}

<div class="mt-8">
	<h2 class="mb-2 font-heading font-medium">排序</h2>
	<SortableList
		items={projects}
		section="projects"
		editBase="/admin/projects"
		viewBase="/projects"
		onReorder={handleReorder}
	/>
</div>