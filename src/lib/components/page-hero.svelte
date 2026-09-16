<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import { ArrowLeft, Hammer } from "@lucide/svelte";

	interface Props {
		icon?: typeof ArrowLeft;
		title: string;
		desc: string;
		backHref?: string;
		/** 未上线功能的占位提示，例如「功能建设中」。传入后附带 noindex，避免搜索引擎收录空页。 */
		note?: string;
	}

	let { icon: Icon = ArrowLeft, title, desc, backHref = "/", note }: Props = $props();
</script>

<svelte:head>
	{#if note}<meta name="robots" content="noindex, follow" />{/if}
</svelte:head>

<div class="mx-auto flex w-full max-w-4xl flex-col items-center gap-8 px-4 py-16 text-center md:px-8">
	<div class="flex size-16 items-center justify-center rounded-2xl bg-primary/15 text-primary">
		<Icon class="size-8" />
	</div>
	<h1 class="text-shimmer font-heading text-3xl font-semibold tracking-tight">{title}</h1>
	<p class="max-w-lg text-muted-foreground">{desc}</p>
	{#if note}
		<div class="inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
			<Hammer class="size-3.5" />
			{note}
		</div>
	{/if}
	<Button href={backHref} variant="secondary">
		<ArrowLeft class="size-4 mr-2" />
		返回首页
	</Button>
</div>