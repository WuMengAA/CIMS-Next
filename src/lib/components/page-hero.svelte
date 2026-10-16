<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import { ArrowLeft, Hammer } from "@lucide/svelte";
	import { reveal } from "$lib/actions/reveal.js";

	interface Props {
		icon?: typeof ArrowLeft;
		title: string;
		desc: string;
		backHref?: string;
		/**
		 * 未上线功能的占位提示（页面上的"功能建设中"横幅）。
		 *
		 * ⚠️ 这里**不再**输出 <meta name="robots">：全站 robots/noindex 已统一由
		 * <Seo> 组件负责（见 $lib/components/Seo.svelte）。两处各写一份会同时输出
		 * 两个 robots 标签且指令可能冲突（noindex, follow vs noindex, nofollow）。
		 * 占位页要屏蔽收录，请在页面上传 <Seo noindex />。
		 */
		note?: string;
	}

	let { icon: Icon = ArrowLeft, title, desc, backHref = "/", note }: Props = $props();
</script>

<!-- 编辑流体内页 Hero：窄列左对齐、信号线标签、Fraunces 超大标题、pill 返回 -->
<div class="mx-auto flex w-full max-w-[980px] flex-col gap-5 px-4 py-16 md:px-8 md:py-24">
	<div use:reveal class="reveal ef-label" style="--reveal-delay:0"><Icon class="size-3.5 text-primary" /></div>
	<h1 use:reveal class="reveal reveal-mask ef-hero-title font-heading" style="--reveal-delay:1">{title}</h1>
	<p use:reveal class="reveal max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg" style="--reveal-delay:2">{desc}</p>
	{#if note}
		<div class="inline-flex items-center gap-2 self-start rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
			<Hammer class="size-3.5" />
			{note}
		</div>
	{/if}
	<div>
		<Button href={backHref} variant="secondary" class="ef-cta">
			<ArrowLeft class="size-4 mr-2" />
			返回首页
		</Button>
	</div>
</div>
