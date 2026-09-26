<script lang="ts">
	import Container from "$lib/components/container.svelte";
	import PageHeader from "$lib/components/page-header.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Radio } from "@lucide/svelte";

	// 草稿示例广播记录 —— 实时广播由集控面板（CIMS）推送，可在此做公开只读展示。
	const broadcasts = [
		{ time: "今日 12:05", scope: "全校", text: "午休结束，请同学们有序返回教室，准备下午课程。" },
		{ time: "今日 09:50", scope: "高一", text: "高一（1）班 assemblies 集合，请到操场参加晨会。" },
		{ time: "昨日 16:30", scope: "全校", text: "放学提醒：请关好门窗、切断电源，注意交通安全。" },
		{ time: "昨日 10:00", scope: "高二", text: "高二（3）班主题班会改至明天第一节，请提前准备。" }
	];
</script>

<svelte:head>
	<title>校园广播 · 星集控</title>
	<meta name="description" content="校园广播（草稿）——校园通知与定时广播一览。" />
</svelte:head>

<Container>
	<PageHeader title="校园广播" description="校园通知与定时广播 · 草稿示例内容" />

	<div class="reveal flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300" style="--reveal-delay:1">
		<span>⚠️ 本页为草稿示例内容，广播记录为占位。</span>
		<span class="ml-auto">实时广播由集控面板推送 →</span>
		<Button href="/admin/console" size="sm" variant="outline">前往集控面板</Button>
	</div>

	<section class="reveal space-y-3" style="--reveal-delay:2">
		{#each broadcasts as b}
			<article class="flex gap-4 rounded-xl border bg-card p-4">
				<div class="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
					<Radio class="size-4" />
				</div>
				<div class="min-w-0 flex-1">
					<div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
						<span>{b.time}</span>
						<span class="rounded bg-secondary px-1.5 py-0.5">{b.scope}</span>
					</div>
					<p class="mt-1 text-sm">{b.text}</p>
				</div>
			</article>
		{/each}
	</section>
</Container>
