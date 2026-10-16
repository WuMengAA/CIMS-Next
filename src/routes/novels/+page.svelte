<script lang="ts">
	import PageHero from "$lib/components/page-hero.svelte";
	import { BookMarked } from "@lucide/svelte";
import Seo from "$lib/components/Seo.svelte";
</script>

<Seo title="交互小说"
	description="交互式小说与分支叙事。"
	path="/novels"
	noindex
/>

<PageHero icon={BookMarked} title="交互小说" desc="可以选择的剧情，由你书写结局。" note="功能建设中" />