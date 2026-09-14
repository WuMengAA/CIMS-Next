<script lang="ts">
	import PageHero from "$lib/components/page-hero.svelte";
	import { Wrench, Palette, Image as ImageIcon } from "@lucide/svelte";

	const tools = [
		{
			href: "/tools/cover-generator",
			icon: Palette,
			title: "封面生成器",
			desc: "确定性模板封面，实时预览，导出 SVG / PNG。"
		}
	];
</script>

<svelte:head>
	<title>工具集 | Stelarith</title>
</svelte:head>

<PageHero icon={Wrench} title="工具集" desc="常用在线小工具集合。" />

<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
	{#each tools as t}
		<!-- 原先写死 border-white/10 bg-black/20 text-white/55 —— 那是"深色专用"，
		     亮色主题下会变成浅灰卡片配白字（不可读）；图标底色还用错了令牌
		     （--accent 是面/背景色不是品牌色，深色下同样偏灰不显眼）。
		     改用语义令牌后两种主题都正确。 -->
		<a
			href={t.href}
			class="group rounded-2xl border border-border bg-card p-5 transition hover:border-primary/50 hover:bg-accent"
		>
			<div class="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-primary/12 text-primary">
				<t.icon size={22} />
			</div>
			<h3 class="text-lg font-semibold text-foreground">{t.title}</h3>
			<p class="mt-1 text-sm text-muted-foreground">{t.desc}</p>
		</a>
	{/each}
</div>
