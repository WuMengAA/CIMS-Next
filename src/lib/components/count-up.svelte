<script lang="ts">
	import { onMount } from "svelte";

	let { value = 0, duration = 1200, suffix = "", prefix = "", decimals = 0 }: { value?: number; duration?: number; suffix?: string; prefix?: string; decimals?: number } = $props();

	let display = $state(0);
	let el: HTMLSpanElement | undefined = $state(undefined);

	onMount(() => {
		if (!el) return;
		const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		const io = new IntersectionObserver((entries) => {
			if (entries[0].isIntersecting) {
				io.disconnect();
				if (reduce) { display = value; return; }
				const start = performance.now();
				const tick = (now: number) => {
					const p = Math.min(1, (now - start) / duration);
					// easeOutCubic for smooth deceleration
					const e = 1 - Math.pow(1 - p, 3);
					display = Math.round(value * e);
					if (p < 1) requestAnimationFrame(tick);
				};
				requestAnimationFrame(tick);
			}
		}, { threshold: 0.4 });
		io.observe(el);
		return () => io.disconnect();
	});
</script>

<span bind:this={el} class="tabular-nums">{prefix}{display.toFixed(decimals)}{suffix}</span>