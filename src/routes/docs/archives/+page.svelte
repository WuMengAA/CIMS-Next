<svelte:head>
	<title>档案库 | Stelarith</title>
</svelte:head>

<script lang="ts">
	import Container from "$lib/components/container.svelte";
	import RhineArchive from "$lib/components/rhine/rhine-archive.svelte";
	import { goto } from "$app/navigation";

	let { data }: { data: { docs: any[] } } = $props();
</script>

<div class="rhine-docs min-h-screen bg-background text-foreground">
	<Container>
		<header class="rhine-screen relative flex flex-col gap-5 border border-border/70 px-5 py-6 md:px-8 md:py-8">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<span class="rhine-tick"></span>
				<span class="rhine-label">Internal Database · 档案库</span>
				<span class="rhine-label rhine-label-sm">RhineLab Archive Engine</span>
			</div>
			<div class="flex flex-col gap-2">
				<h1 class="text-3xl font-semibold tracking-tight md:text-4xl">档案库</h1>
				<p class="max-w-2xl text-sm text-muted-foreground">
					用原版档案引擎浏览本库教程：← → 切换列，↑ ↓ 换档案，Enter 读取。
				</p>
			</div>
		</header>

		<RhineArchive docs={data.docs} onOpen={(href) => goto(href)} />
	</Container>
</div>