<script lang="ts">
	import { onMount } from "svelte";
	let { target }: { target: string } = $props();

	onMount(() => {
		try {
			const today = new Date().toISOString().slice(0, 10);
			const key = "viewed:" + target + ":" + today;
			if (sessionStorage.getItem(key)) return; // 同 tab 同日只计一次
			sessionStorage.setItem(key, "1");
			fetch("/api/stats", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ target })
			}).catch(() => {});
		} catch { /* sessionStorage 不可用时静默 */ }
	});
</script>
