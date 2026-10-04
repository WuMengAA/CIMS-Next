<script lang="ts">
	import { reveal } from "$lib/actions/reveal.js";

	let {
		title,
		description = "",
		eyebrow = "",
		class: className = ""
	}: { title: string; description?: string; eyebrow?: string; class?: string } = $props();
</script>

<header class="ef-section-head {className}">
	{#if eyebrow}
		<div use:reveal class="reveal ef-label" style="--reveal-delay:0">{eyebrow}</div>
	{:else}
		<div use:reveal class="reveal ef-label" style="--reveal-delay:0">Stelarith</div>
	{/if}
	<h1 use:reveal class="reveal reveal-mask font-heading text-3xl font-semibold tracking-tight md:text-4xl" style="--reveal-delay:1">{title}</h1>
	{#if description}
		<p use:reveal class="reveal ef-sub" style="--reveal-delay:2">{description}</p>
	{/if}
	<span use:reveal class="reveal ef-draw mt-2" style="--reveal-delay:3"></span>
</header>
