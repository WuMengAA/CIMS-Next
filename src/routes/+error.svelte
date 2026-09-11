<script lang="ts">
	import { page } from "$app/state";
	import { Button } from "$lib/components/ui/button/index.js";
	import { FileQuestion, AlertTriangle, ArrowLeft, Home } from "@lucide/svelte";

	const is404 = $derived(page.status === 404);
</script>

<svelte:head>
	<title>{page.status === 404 ? "页面不存在" : "出错了"} | Stelarith</title>
</svelte:head>

<div class="flex min-h-[70vh] flex-col items-center justify-center gap-6 px-4 text-center">
	<div class="flex size-16 items-center justify-center rounded-2xl bg-primary/15 text-primary">
		{#if page.status === 404}
			<FileQuestion class="size-8" />
		{:else}
			<AlertTriangle class="size-8" />
		{/if}
	</div>
	<h1 class="font-heading text-4xl font-semibold tracking-tight">{page.status === 404 ? "页面不存在" : "出错了"}</h1>
	<p class="max-w-md text-sm text-muted-foreground">
		{#if page.status === 404}
			你访问的页面不存在或已被移动。
		{:else}
			服务器在处理请求时遇到了问题，请稍后再试。
		{/if}
	</p>
	<div class="flex items-center gap-3">
		<Button variant="secondary" onclick={() => history.back()}>
			<ArrowLeft class="size-4 mr-2" />
			返回上页
		</Button>
		<Button href="/">
			<Home class="size-4 mr-2" />
			返回首页
		</Button>
	</div>
</div>