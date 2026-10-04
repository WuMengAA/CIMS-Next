<script lang="ts">
	import type { Snippet } from "svelte";
	let {
		children,
		class: className = "",
		size = "content"
	}: { children: Snippet; class?: string; size?: "narrow" | "content" | "wide" | "max" } = $props();

	const sizeClass = $derived(
		size === "narrow" ? "ef-shell--narrow"
		: size === "wide" ? "ef-shell--wide"
		: size === "max" ? "ef-shell--max"
		: ""
	);
</script>

<div class="ef-shell {sizeClass} flex flex-col gap-8 py-10 {className}">
	{@render children()}
</div>
