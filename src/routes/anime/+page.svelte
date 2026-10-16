<script lang="ts">
	import PageHero from "$lib/components/page-hero.svelte";
	import { Clapperboard } from "@lucide/svelte";
import Seo from "$lib/components/Seo.svelte";
</script>

<Seo title="追番"
	description="追番记录与番剧时间表。"
	path="/anime"
	noindex
/>

<PageHero icon={Clapperboard} title="追番" desc="追番列表、评分与观后感。" note="功能建设中" />