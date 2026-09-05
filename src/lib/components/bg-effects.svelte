<script lang="ts">
	import { page } from "$app/state";
	import Starfield from "./starfield.svelte";

	interface BgCfg { style: string; color1: string; color2: string; color3: string; intensity: number; speed: number; particles: boolean }
	let { config }: { config?: BgCfg } = $props();

	const cfg = $derived(config || { style: "aurora", color1: "#cc785c", color2: "#8b5cf6", color3: "#0ea5e9", intensity: 0.5, speed: 1, particles: true });

	// CSS vars for the effect layers
	const styleVars = $derived({
		"--bg-c1": cfg.color1,
		"--bg-c2": cfg.color2,
		"--bg-c3": cfg.color3,
		"--bg-alpha": String(Math.max(0.05, Math.min(0.9, cfg.intensity))),
		"--bg-speed": String(Math.max(0.2, Math.min(3, cfg.speed)))
	});
</script>

<svelte:head>
	<style>
		/* Background effect layers — fixed, behind all content */
		.bg-stage {
			position: fixed;
			inset: 0;
			z-index: -2;
			pointer-events: none;
			overflow: hidden;
		}
		.bg-stage .aurora {
			position: absolute;
			inset: -20%;
			background:
				radial-gradient(38% 42% at 22% 28%, var(--bg-c1) 0%, transparent 62%),
				radial-gradient(32% 36% at 78% 22%, var(--bg-c2) 0%, transparent 60%),
				radial-gradient(44% 46% at 55% 80%, var(--bg-c3) 0%, transparent 65%);
			animation: aurora-drift calc(var(--bg-speed) * 22s) ease-in-out infinite alternate;
			opacity: var(--bg-alpha);
			will-change: transform;
		}
		@keyframes aurora-drift {
			0% { transform: translate3d(-2%, -1%, 0) rotate(0deg) scale(1); }
			50% { transform: translate3d(3%, 2%, 0) rotate(3deg) scale(1.08); }
			100% { transform: translate3d(-1%, 1%, 0) rotate(-2deg) scale(0.96); }
		}
		.bg-stage .grid {
			position: absolute;
			inset: 0;
			background-image:
				linear-gradient(var(--bg-c1) 1px, transparent 1px),
				linear-gradient(90deg, var(--bg-c1) 1px, transparent 1px);
			background-size: 52px 52px;
			opacity: calc(var(--bg-alpha) * 0.28);
			mask-image: radial-gradient(ellipse 90% 70% at 50% 0%, black 30%, transparent 75%);
			animation: grid-pan calc(var(--bg-speed) * 26s) linear infinite;
		}
		@keyframes grid-pan { from { background-position: 0 0; } to { background-position: 52px 52px; } }
		.bg-stage .particles {
			position: absolute;
			inset: 0;
			opacity: calc(var(--bg-alpha) * 0.5);
			background-image:
				radial-gradient(2px 2px at 20% 30%, var(--bg-c1) 50%, transparent 51%),
				radial-gradient(1.6px 1.6px at 65% 70%, var(--bg-c2) 50%, transparent 51%),
				radial-gradient(1.4px 1.4px at 40% 55%, var(--bg-c3) 50%, transparent 51%),
				radial-gradient(2px 2px at 85% 20%, var(--bg-c1) 50%, transparent 51%),
				radial-gradient(1.8px 1.8px at 10% 75%, var(--bg-c2) 50%, transparent 51%),
				radial-gradient(1.5px 1.5px at 50% 12%, var(--bg-c3) 50%, transparent 51%);
			background-size: 260px 260px;
			animation: particles-float calc(var(--bg-speed) * 30s) linear infinite;
		}
		@keyframes particles-float { from { background-position: 0 0; } to { background-position: 260px 260px; } }
		/* 彩虹渐变（缓慢流动，颜色来自三色） —— 作为可选 style */
		.bg-stage .rainbow {
			position: absolute;
			inset: 0;
			background: linear-gradient(120deg, var(--bg-c1), var(--bg-c2), var(--bg-c3), var(--bg-c1));
			background-size: 300% 300%;
			opacity: calc(var(--bg-alpha) * 0.14);
			animation: rainbow-flow calc(var(--bg-speed) * 18s) ease-in-out infinite;
		}
		@keyframes rainbow-flow { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
		@media (prefers-reduced-motion: reduce) {
			.bg-stage .aurora, .bg-stage .grid, .bg-stage .particles, .bg-stage .rainbow { animation: none !important; }
		}
	</style>
</svelte:head>

<div class="bg-stage" aria-hidden="true">
	{#if cfg.style === "grid"}
		<div class="grid"></div>
	{:else if cfg.style === "particles"}
		<Starfield color={cfg.color1} count={90} lineDist={150} speed={cfg.speed} />
		<div class="particles"></div>
		<div class="aurora"></div>
	{:else if cfg.style === "rainbow"}
		<div class="rainbow"></div>
	{:else}
		<div class="aurora"></div>
		{#if cfg.particles}<Starfield color={cfg.color2} count={60} lineDist={130} speed={cfg.speed} />{/if}
	{/if}
</div>