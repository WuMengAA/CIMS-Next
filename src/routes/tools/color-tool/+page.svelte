<script lang="ts">
	import PageHero from "$lib/components/page-hero.svelte";
	import { Card } from "$lib/components/ui/card/index.js";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Droplet, Copy, Check, Contrast } from "@lucide/svelte";

	let base = $state("#6366f1");
	let fg = $state("#ffffff");
	let bg = $state("#1e1b4b");
	let copied = $state("");

	async function copy(text: string, key: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = key;
			setTimeout(() => (copied = ""), 1200);
		} catch {}
	}

	// ── 颜色数学 ─────────────────────────────────────────────
	function hexToRgb(hex: string): [number, number, number] {
		const h = hex.replace("#", "").trim();
		if (!/^[0-9a-fA-F]{6}$/.test(h)) return [0, 0, 0];
		return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
	}
	function rgbToHex(r: number, g: number, b: number): string {
		return "#" + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");
	}
	function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
		r /= 255; g /= 255; b /= 255;
		const max = Math.max(r, g, b), min = Math.min(r, g, b);
		let h = 0, s = 0;
		const l = (max + min) / 2;
		if (max !== min) {
			const d = max - min;
			s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
			if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
			else if (max === g) h = (b - r) / d + 2;
			else h = (r - g) / d + 4;
			h /= 6;
		}
		return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
	}
	function lum([r, g, b]: [number, number, number]): number {
		const f = (v: number) => {
			const c = v / 255;
			return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
		};
		return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
	}
	function ratio(a: string, b: string): number {
		const la = lum(hexToRgb(a)), lb = lum(hexToRgb(b));
		const [hi, lo] = la > lb ? [la, lb] : [lb, la];
		return (hi + 0.05) / (lo + 0.05);
	}

	// ── 派生状态 ─────────────────────────────────────────────
	const rgb = $derived(hexToRgb(base));
	const hsl = $derived(rgbToHsl(...rgb));
	const palette = $derived.by(() => {
		const [r, g, b] = rgb;
		const [h, s, l] = hsl;
		return [
			{ name: "主色", hex: rgbToHex(r, g, b) },
			{ name: "互补", hex: rgbToHex(...(hslToRgb((h + 180) % 360, s, l) as [number, number, number])) },
			{ name: "近似 +30°", hex: rgbToHex(...(hslToRgb((h + 30) % 360, s, l) as [number, number, number])) },
			{ name: "近似 −30°", hex: rgbToHex(...(hslToRgb((h + 330) % 360, s, l) as [number, number, number])) },
			{ name: "三元 +120°", hex: rgbToHex(...(hslToRgb((h + 120) % 360, s, l) as [number, number, number])) },
			{ name: "三元 +240°", hex: rgbToHex(...(hslToRgb((h + 240) % 360, s, l) as [number, number, number])) }
		];
	});
	function hslToRgb(h: number, s: number, l: number): [number, number, number] {
		s /= 100; l /= 100;
		const k = (n: number) => (n + h / 30) % 12;
		const a = s * Math.min(l, 1 - l);
		const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
		return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
	}

	const cr = $derived(ratio(fg, bg));
	const crLevel = $derived(cr >= 7 ? "AAA 通过" : cr >= 4.5 ? "AA 通过" : cr >= 3 ? "AA 大字通过" : "不通过");
	const crOk = $derived(cr >= 4.5);
	const shade = (base: string, amt: number) => {
		const [r, g, b] = hexToRgb(base);
		const t = amt < 0 ? 0 : 255;
		const a = Math.abs(amt);
		return rgbToHex(r + (t - r) * a, g + (t - g) * a, b + (t - b) * a);
	};
	const scale = $derived([-0.25, -0.1, 0, 0.1, 0.25].map((a) => shade(base, a)));
</script>

<svelte:head>
	<title>色位工具 | Stelarith</title>
</svelte:head>

<PageHero icon={Droplet} title="色位工具" desc="调色板、色值转换、对比度检测。全部在本地完成，不上传任何数据。" />

<div class="mx-auto grid max-w-5xl gap-5 px-4 py-8 md:grid-cols-2">
	<!-- 基础色 -->
	<Card class="p-5">
		<h3 class="mb-3 font-heading text-base font-semibold">基础色</h3>
		<div class="flex items-center gap-3">
			<input type="color" bind:value={base} class="size-12 cursor-pointer rounded-lg border border-border" />
			<div class="flex-1 space-y-1.5">
				<Input bind:value={base} placeholder="#RRGGBB" class="font-mono" />
				<div class="flex items-center justify-between text-xs text-muted-foreground">
					<span>RGB {rgb.join(", ")}</span>
					<span>HSL {hsl[0]}° {hsl[1]}% {hsl[2]}%</span>
				</div>
			</div>
			<Button variant="outline" size="sm" onclick={() => copy(base, "base")}>
				{#if copied === "base"}<Check class="size-4 text-primary" />{:else}<Copy class="size-4" />{/if}
			</Button>
		</div>

		<!-- 色阶 -->
		<p class="mb-2 mt-4 text-xs font-medium text-muted-foreground">明暗色阶</p>
		<div class="flex gap-1.5">
			{#each scale as c, i (i)}
				<div class="flex-1">
					<div class="h-10 rounded-md border border-border" style="background:{c}" title={c}></div>
					<p class="mt-1 text-center font-mono text-[10px] text-muted-foreground">{c}</p>
				</div>
			{/each}
		</div>

		<!-- 调色板 -->
		<p class="mb-2 mt-4 text-xs font-medium text-muted-foreground">调色板</p>
		<div class="grid grid-cols-3 gap-1.5">
			{#each palette as p (p.name)}
				<button
					class="flex h-16 flex-col items-start justify-end rounded-md p-2 text-left transition hover:scale-[1.03]"
					style="background:{p.hex};color:{cr >= 4.5 ? '#000' : '#fff'}"
					title={p.hex}
					onclick={() => copy(p.hex, p.name)}
				>
					<span class="text-[10px] font-medium opacity-80">{p.name}</span>
					<span class="font-mono text-[10px]">{p.hex}</span>
				</button>
			{/each}
		</div>
	</Card>

	<!-- 对比度检测 -->
	<Card class="p-5">
		<h3 class="mb-3 flex items-center gap-2 font-heading text-base font-semibold">
			<Contrast class="size-4 text-primary" />对比度检测
		</h3>
		<div class="grid grid-cols-2 gap-3">
			<div class="grid gap-1.5">
				<label class="text-xs text-muted-foreground">前景色</label>
				<div class="flex items-center gap-2">
					<input type="color" bind:value={fg} class="size-10 cursor-pointer rounded-md border border-border" />
					<Input bind:value={fg} class="font-mono text-xs" />
				</div>
			</div>
			<div class="grid gap-1.5">
				<label class="text-xs text-muted-foreground">背景色</label>
				<div class="flex items-center gap-2">
					<input type="color" bind:value={bg} class="size-10 cursor-pointer rounded-md border border-border" />
					<Input bind:value={bg} class="font-mono text-xs" />
				</div>
			</div>
		</div>
		<div class="mt-3 flex h-24 items-center justify-center rounded-lg border border-border" style="background:{bg};color:{fg}">
			<p class="font-heading text-xl">对比度示例文本</p>
		</div>
		<div class="mt-3 flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
			<span class="text-sm">对比度 {cr.toFixed(2)} : 1</span>
			<span class={`rounded-md px-2 py-0.5 text-xs font-medium ${crOk ? "bg-emerald-500/15 text-emerald-600" : "bg-red-500/15 text-red-600"}`}>{crLevel}</span>
		</div>
		<div class="mt-3 grid grid-cols-3 gap-2 text-center text-xs text-muted-foreground">
			<div class="rounded-md bg-muted/40 p-2">普通文本：≥ 4.5</div>
			<div class="rounded-md bg-muted/40 p-2">大字文本：≥ 3.0</div>
			<div class="rounded-md bg-muted/40 p-2">WCAG AAA：≥ 7.0</div>
		</div>
	</Card>
</div>
