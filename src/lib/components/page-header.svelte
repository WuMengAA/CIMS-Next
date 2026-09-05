<script lang="ts">
	let {
		title,
		description = "",
		class: className = ""
	}: { title: string; description?: string; class?: string } = $props();
</script>

<header class="reveal flex flex-col gap-2 {className}" style="--reveal-delay:0">
	<h1 class="font-heading text-3xl font-semibold tracking-tight">{title}</h1>
	{#if description}<p class="text-sm text-muted-foreground">{description}</p>{/if}
</header>
