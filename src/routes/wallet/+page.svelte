<script lang="ts">
	import PageHero from "$lib/components/page-hero.svelte";
	import { Wallet } from "@lucide/svelte";
import Seo from "$lib/components/Seo.svelte";
</script>

<Seo title="钱包"
	description="个人钱包。"
	path="/wallet"
	noindex
/>

<PageHero icon={Wallet} title="钱包" desc="余额、账单与赞助记录。" note="功能建设中" />