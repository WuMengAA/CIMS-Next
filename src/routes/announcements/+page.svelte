<script lang="ts">
	import { Megaphone, Info, CheckCircle2, AlertTriangle, AlertOctagon, Pin } from "@lucide/svelte";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	const LEVEL: Record<string, { cls: string; Icon: any }> = {
		info: { cls: "border-sky-500/40 bg-sky-500/10 text-sky-100", Icon: Info },
		success: { cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100", Icon: CheckCircle2 },
		warning: { cls: "border-amber-500/40 bg-amber-500/10 text-amber-100", Icon: AlertTriangle },
		danger: { cls: "border-rose-500/40 bg-rose-500/10 text-rose-100", Icon: AlertOctagon }
	};
</script>

<svelte:head>
	<title>公告 | Stelarith</title>
	<meta name="description" content="站点公告与重要通知" />
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto flex w-full max-w-[1400px] flex-col gap-8 px-4 py-10 md:px-8">
	<header class="flex flex-col gap-2">
		<h1 class="flex items-center gap-2 font-heading text-3xl font-semibold tracking-tight">
			<Megaphone class="size-7 text-primary" /> 公告
		</h1>
		<p class="text-sm text-muted-foreground">站点动态、维护通知与重要提醒</p>
	</header>

	{#if data.announcements.length === 0}
		<div class="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">暂无公告</div>
	{:else}
		<div class="flex flex-col gap-4">
			{#each data.announcements as a (a.id)}
				{@const s = LEVEL[a.level] || LEVEL.info}
				{@const Icon = s.Icon}
				<article class="rounded-xl border px-5 py-4 {s.cls}">
					<div class="flex items-center gap-2">
						<Icon class="size-4 shrink-0" />
						<h2 class="font-heading text-lg font-semibold">{a.title}</h2>
						{#if a.pinned}<Pin class="size-3.5 shrink-0 opacity-80" />{/if}
						<span class="ml-auto text-xs opacity-70">{a.createdAt?.slice(0, 10)}</span>
					</div>
					{#if a.content}
						<p class="mt-2 whitespace-pre-wrap text-sm leading-relaxed opacity-90">{a.content}</p>
					{/if}
				</article>
			{/each}
		</div>
	{/if}
</div>
