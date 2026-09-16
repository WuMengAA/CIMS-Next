<script lang="ts">
	import type { PageProps } from "./$types";
	import { Music2, ExternalLink } from "@lucide/svelte";
	import EmbedWeb from "$lib/components/embed-web.svelte";

	let { data }: PageProps = $props();
	const embedSrc = $derived(
		data.base && data.base !== "https://voicehub.245959623.xyz"
			? data.base
			: "https://voicehub.245959623.xyz"
	);
</script>

<svelte:head>
	<title>校园点歌 | Stelarith</title>
	<meta name="description" content="校园点歌，由 voicehub 校园点歌站提供，内嵌实时点歌页" />
</svelte:head>

<div class="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-4 py-10 md:px-8">
	<header class="flex flex-col gap-2">
		<h1 class="flex items-center gap-2 font-heading text-3xl font-semibold tracking-tight">
			<Music2 class="size-7 text-primary" /> 校园点歌
		</h1>
		<p class="text-sm text-muted-foreground">内嵌 voicehub 校园点歌站 · 支持宽度调整与全屏打开</p>
		<a
			href={embedSrc}
			target="_blank"
			rel="noopener"
			class="inline-flex w-fit items-center gap-1 text-sm text-primary hover:underline"
		>
			新窗口打开点歌站 <ExternalLink class="size-4" />
		</a>
	</header>

	{#if !data.configured}
		<div class="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
			点歌站尚未接入（未配置 VOICEHUB_BASE / VOICEHUB_KEY）。<br />
			在 .env 配置后即可内嵌展示。
		</div>
	{:else if data.error}
		<div class="rounded-xl border border-red-500/40 bg-red-500/10 p-8 text-center text-sm">
			<p class="font-medium text-red-300">已配置 Voicehub，但连接失败</p>
			<p class="mt-2 text-muted-foreground">
				HTTP 状态：{data.errorStatus ?? "未知（网络异常）"}。<br />
				请检查 VOICEHUB_KEY 是否有效、是否具备 <code class="rounded bg-black/30 px-1">songs:read</code> 权限，且 VOICEHUB_BASE 指向正确的实例。
			</p>
		</div>
	{:else}
		<EmbedWeb src={embedSrc} title="voicehub 校园点歌站" height={760} />
	{/if}
</div>
