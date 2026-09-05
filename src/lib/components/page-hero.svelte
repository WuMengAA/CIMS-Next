<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import { ArrowLeft } from "@lucide/svelte";

	interface Props {
		icon?: typeof ArrowLeft;
		title: string;
		desc: string;
		backHref?: string;
	}

	let { icon: Icon = ArrowLeft, title, desc, backHref = "/" }: Props = $props();
</script>

<div class="mx-auto flex w-full max-w-4xl flex-col items-center gap-8 px-4 py-16 text-center md:px-8">
	<div class="flex size-16 items-center justify-center rounded-2xl bg-primary/15 text-primary">
		<Icon class="size-8" />
	</div>
	<h1 class="font-heading text-3xl font-semibold tracking-tight">{title}</h1>
	<p class="max-w-lg text-muted-foreground">{desc}</p>
	<Button asChild variant="secondary">
		<a href={backHref}>
			<ArrowLeft class="size-4 mr-2" />
			返回首页
		</a>
	</Button>
</div>