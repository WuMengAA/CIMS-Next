<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import { ArrowUp, ArrowDown, GripVertical, Trash2, Pencil, ExternalLink } from "@lucide/svelte";

	interface Item {
		slug: string;
		title: string;
		date?: string;
		category?: string;
		excerpt?: string;
		[key: string]: unknown;
	}

	let {
		items,
		section,
		editBase,
		viewBase,
		onReorder
	}: {
		items: Item[];
		section: "posts" | "projects" | "docs";
		editBase: string;
		viewBase?: string;
		onReorder: (ordered: string[]) => void;
	} = $props();

	let dragIndex = $state<number | null>(null);

	function moveUp(index: number) {
		if (index <= 0) return;
		const arr = [...items];
		[arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
		items = arr;
		onReorder(arr.map(i => i.slug));
	}

	function moveDown(index: number) {
		if (index >= items.length - 1) return;
		const arr = [...items];
		[arr[index + 1], arr[index]] = [arr[index], arr[index + 1]];
		items = arr;
		onReorder(arr.map(i => i.slug));
	}

	function onDragStart(index: number) {
		dragIndex = index;
	}

	function onDragOver(e: DragEvent, index: number) {
		e.preventDefault();
		if (dragIndex === null || dragIndex === index) return;
		const arr = [...items];
		const [moved] = arr.splice(dragIndex, 1);
		arr.splice(index, 0, moved);
		dragIndex = index;
		items = arr;
	}

	function onDrop() {
		dragIndex = null;
		onReorder(items.map(i => i.slug));
	}
</script>

<div class="space-y-2">
	{#each items as item, i (item.slug)}
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
				<span class="truncate font-medium">{item.title}</span>
				{#if item.excerpt}
					<p class="line-clamp-1 text-xs text-muted-foreground">{item.excerpt}</p>
				{/if}
			</div>
			<div class="flex shrink-0 items-center gap-1">
				<Button variant="ghost" size="icon" class="h-7 w-7" onclick={() => moveUp(i)} disabled={i === 0}>
					<ArrowUp class="h-3.5 w-3.5" />
				</Button>
				<Button variant="ghost" size="icon" class="h-7 w-7" onclick={() => moveDown(i)} disabled={i === items.length - 1}>
					<ArrowDown class="h-3.5 w-3.5" />
				</Button>
				{#if viewBase}
					<a href="{viewBase}/{item.slug}" target="_blank" class="p-1.5 text-muted-foreground hover:text-foreground">
						<ExternalLink class="h-4 w-4" />
					</a>
				{/if}
				<a href="{editBase}/{item.slug}" class="p-1.5 text-muted-foreground hover:text-foreground">
					<Pencil class="h-4 w-4" />
				</a>
			</div>
		</div>
	{/each}
</div>