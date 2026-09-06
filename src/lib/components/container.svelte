<script lang="ts">
	import type { Snippet } from "svelte";
	let {
		children,
		class: className = ""
	}: { children: Snippet; class?: string } = $props();
</script>

<div class="mx-auto flex w-full max-w-[1400px] flex-col gap-8 px-4 py-10 md:px-8 {className}">
	{@render children()}
</div>
