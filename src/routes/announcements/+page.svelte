<script lang="ts">
	import { Megaphone, Info, CheckCircle2, AlertTriangle, AlertOctagon, Pin } from "@lucide/svelte";
	import Seo from "$lib/components/Seo.svelte";
	import PageHeader from "$lib/components/page-header.svelte";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	const LEVEL: Record<string, { cls: string; Icon: any }> = {
		info: { cls: "border-sky-500/40 bg-sky-500/10 text-sky-100", Icon: Info },
		success: { cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100", Icon: CheckCircle2 },
		warning: { cls: "border-amber-500/40 bg-amber-500/10 text-amber-100", Icon: AlertTriangle },
		danger: { cls: "border-rose-500/40 bg-rose-500/10 text-rose-100", Icon: AlertOctagon }
	};
</script>

<!-- noindex 保留原样：公告是时效性内容，不该占搜索结果位 -->
<Seo
	title="公告"
	description="站点公告与重要通知"
	path="/announcements"
	noindex
/>

<div class="ef-shell flex flex-col gap-8 py-10">
	<PageHeader eyebrow="Announcements" title="公告" description="站点动态、维护通知与重要提醒" />

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
