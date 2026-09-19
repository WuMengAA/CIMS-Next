<svelte:head>
	<title>档案库 | Stelarith</title>
</svelte:head>

<script lang="ts">
	import RhineArchive from "$lib/components/rhine/rhine-archive.svelte";
	import { goto } from "$app/navigation";

	let { data }: { data: { docs: any[] } } = $props();
</script>

<!-- 全屏沉浸式档案库：不套 Container / 页眉盒，直接铺满可视区 -->
<div class="rhine-fullscreen">
	<RhineArchive docs={data.docs} onOpen={(href) => goto(href)} />
</div>

<style>
	.rhine-fullscreen {
		position: fixed;
		inset: 0;
		z-index: 40;
		background: var(--rhine-paper, #eae5e1);
	}
</style>