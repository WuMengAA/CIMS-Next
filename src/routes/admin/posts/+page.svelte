<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Plus, Edit, Trash2, Eye, Pin, ArrowUp, ArrowDown, GripVertical } from "@lucide/svelte";
	import { toast } from "svelte-sonner";
	import { Skeleton } from "$lib/components/ui/skeleton/index.js";
	import { confirmDelete } from "$lib/components/admin/confirm.svelte";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	// 初始数据来自 load（导航期已取回），后续刷新仍走手动 loadPosts
	let posts = $state<any[]>(data.posts);
	let loading = $state(false);
	let dragIndex = $state<number | null>(null);

	async function loadPosts() {
		loading = true;
		try {
			posts = (await (await fetch("/api/posts")).json()) as any[];
		} catch (e) {
			console.error(e);
		}
		loading = false;
	}

	async function saveOrder() {
		try {
			await fetch("/api/posts", {
				method: "POST",
				headers: { "Content-Type": "application/json", "x-action": "reorder" },
				body: JSON.stringify({ orderedSlugs: posts.map(p => p.slug) })
			});
		} catch (e) {
			console.error(e);
		}
	}

	function moveUp(index: number) {
		if (index <= 0) return;
		const arr = [...posts];
		[arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
		posts = arr;
		saveOrder();
	}

	function moveDown(index: number) {
		if (index >= posts.length - 1) return;
		const arr = [...posts];
		[arr[index + 1], arr[index]] = [arr[index], arr[index + 1]];
		posts = arr;
		saveOrder();
	}

	function onDragStart(index: number) {
		dragIndex = index;
	}

	function onDragOver(e: DragEvent, index: number) {
		e.preventDefault();
		if (dragIndex === null || dragIndex === index) return;
		const arr = [...posts];
		const [moved] = arr.splice(dragIndex, 1);
		arr.splice(index, 0, moved);
		dragIndex = index;
		posts = arr;
	}

	function onDrop() {
		dragIndex = null;
		saveOrder();
	}

	async function handleDelete(slug: string) {
		if (!(await confirmDelete("删除文章", "文章将永久删除，此操作不可恢复。"))) return;
		fetch("/api/posts", {
			method: "POST",
			headers: { "Content-Type": "application/json", "x-action": "delete" },
			body: JSON.stringify({ slug })
		}).then(async (res) => {
			if (res.ok) {
				loadPosts();
			} else {
				const d = await res.json().catch(() => ({}));
				toast.error(d.error || "删除失败，请重新登录后再试");
			}
		});
	}

	function handleTogglePin(slug: string, pinned: boolean) {
		const post = posts.find(p => p.slug === slug);
		if (!post) return;
		fetch("/api/posts", {
			method: "POST",
			headers: { "Content-Type": "application/json", "x-action": "save" },
			body: JSON.stringify({ ...post, pinned: !pinned })
		}).then(() => loadPosts());
	}

</script>

<div class="mb-6 flex items-center justify-between">
	<div>
		<h1 class="text-2xl font-heading font-semibold">博客文章</h1>
		<p class="text-sm text-muted-foreground">管理博客文章 · 拖动或按钮调整排序</p>
	</div>
	<Button href="/admin/posts/new">
		<Plus class="h-4 w-4 mr-2" />
		新建文章
	</Button>
</div>

{#if loading}
	<div class="space-y-2" aria-label="加载中">
		{#each Array(4) as _, i (i)}
			<div class="flex items-center gap-3 rounded-lg border p-3">
				<Skeleton class="h-4 w-4 shrink-0" />
				<div class="flex-1 space-y-2">
					<Skeleton class="h-4 w-2/5" />
					<Skeleton class="h-3 w-1/4" />
				</div>
				<Skeleton class="h-7 w-24 shrink-0" />
			</div>
		{/each}
	</div>
{:else if posts.length === 0}
	<div class="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
		<p>暂无文章</p>
		<a href="/admin/posts/new" class="text-primary hover:underline">创建第一篇</a>
	</div>
{:else}
	<div class="space-y-2">
		{#each posts as post, i (post.slug)}
			<div
				role="listitem"
				draggable="true"
				ondragstart={() => onDragStart(i)}
				ondragover={(e) => onDragOver(e, i)}
				ondrop={onDrop}
				class="flex items-center gap-3 rounded-lg border p-3 transition-colors {dragIndex === i ? 'opacity-60 border-primary' : 'hover:bg-accent'}"
			>
				<GripVertical class="h-4 w-4 shrink-0 cursor-grab text-muted-foreground" />
				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-2">
						{#if post.pinned}
							<Pin class="h-3 w-3 shrink-0 text-primary" />
						{/if}
						<span class="truncate font-medium">{post.title}</span>
					</div>
					<div class="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
						<span>{post.date}</span>
						{#if post.category}
							<Badge variant="secondary">{post.category}</Badge>
						{/if}
						{#if post.status !== "published"}
							<Badge variant="outline">{post.status}</Badge>
						{/if}
					</div>
				</div>
				<div class="flex shrink-0 items-center gap-1">
					<Button variant="ghost" size="icon" class="h-7 w-7" onclick={() => moveUp(i)} disabled={i === 0}>
						<ArrowUp class="h-3.5 w-3.5" />
					</Button>
					<Button variant="ghost" size="icon" class="h-7 w-7" onclick={() => moveDown(i)} disabled={i === posts.length - 1}>
						<ArrowDown class="h-3.5 w-3.5" />
					</Button>
					<a href="/posts/{post.slug}" target="_blank" class="p-1.5 text-muted-foreground hover:text-foreground">
						<Eye class="h-4 w-4" />
					</a>
					<a href="/admin/posts/{post.slug}" class="p-1.5 text-muted-foreground hover:text-foreground">
						<Edit class="h-4 w-4" />
					</a>
					<button onclick={() => handleTogglePin(post.slug, post.pinned)} class="p-1.5 {post.pinned ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}" title="置顶/取消置顶">
						<Pin class="h-4 w-4" />
					</button>
					<button onclick={() => handleDelete(post.slug)} class="p-1.5 text-destructive hover:text-destructive" title="删除">
						<Trash2 class="h-4 w-4" />
					</button>
				</div>
			</div>
		{/each}
	</div>
{/if}