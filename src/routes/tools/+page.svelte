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
		<a
			href={t.href}
			class="group rounded-2xl border border-white/10 bg-black/20 p-5 transition hover:border-[var(--accent)]/50 hover:bg-black/30"
		>
			<div class="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-[var(--accent)]/15 text-[var(--accent)]">
				<t.icon size={22} />
			</div>
			<h3 class="text-lg font-semibold text-[var(--foreground)]">{t.title}</h3>
			<p class="mt-1 text-sm text-white/55">{t.desc}</p>
		</a>
	{/each}
</div>
