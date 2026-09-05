<script lang="ts">
	// 客户端导航期间（navigating 超过阈值）展示的页面骨架占位，
	// 复用 shadcn Skeleton，视觉上与正式内容一致，避免"硬切空白"。
	import { Skeleton } from "$lib/components/ui/skeleton/index.js";
	let {
		variant = "list"
	}: { variant?: "list" | "detail" } = $props();
</script>

{#if variant === "detail"}
	<div class="flex flex-col gap-6">
		<div class="flex flex-col gap-3">
			<Skeleton class="h-10 w-3/4 max-w-xl" />
			<Skeleton class="h-4 w-40" />
		</div>
		<div class="flex flex-col gap-3">
			<Skeleton class="h-4 w-full" />
			<Skeleton class="h-4 w-full" />
			<Skeleton class="h-4 w-11/12" />
			<Skeleton class="h-4 w-10/12" />
			<Skeleton class="h-48 w-full rounded-xl" />
			<Skeleton class="h-4 w-full" />
			<Skeleton class="h-4 w-9/12" />
		</div>
	</div>
{:else}
	<div class="flex flex-col gap-6">
		<div class="flex flex-col gap-3">
			<Skeleton class="h-9 w-40" />
			<Skeleton class="h-4 w-72" />
		</div>
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each Array(6) as _, i (i)}
				<Skeleton class="h-40 w-full rounded-xl" />
			{/each}
		</div>
	</div>
{/if}
