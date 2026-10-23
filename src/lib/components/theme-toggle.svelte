<script lang="ts">
	/**
	 * 主题切换：两个正交维度 ——
	 * ① 模式：亮 / 暗 / 跟随系统（mode-watcher，html.dark）
	 * ② 皮肤：经典 / 终末地 BETA（opt-in，html.theme-endfield + localStorage "stelarith-skin"）
	 *
	 * 模式用三态分段（看得见当前在哪、点得到目标态，含"跟随系统"独立态）；
	 * 皮肤用两态分段，终末地标注 BETA（beta 测试 opt-in）。
	 */
	import { setMode, resetMode, userPrefersMode } from "mode-watcher";
	import { onMount } from "svelte";
	import { Sun, Moon, Monitor, Palette, Boxes } from "@lucide/svelte";

	type Pref = "light" | "dark" | "system";
	type Skin = "classic" | "endfield";

	const OPTIONS: { value: Pref; label: string; icon: typeof Sun }[] = [
		{ value: "light", label: "亮色", icon: Sun },
		{ value: "dark", label: "暗色", icon: Moon },
		{ value: "system", label: "跟随系统", icon: Monitor }
	];
	const SKINS: { value: Skin; label: string; icon: any; beta?: boolean }[] = [
		{ value: "classic", label: "经典皮肤", icon: Palette },
		{ value: "endfield", label: "终末地皮肤 BETA", icon: Boxes, beta: true }
	];

	const current = $derived((userPrefersMode.current ?? "system") as Pref);
	let skin = $state<Skin>("classic");
	onMount(() => {
		try {
			skin = (localStorage.getItem("stelarith-skin") as Skin) === "endfield" ? "endfield" : "classic";
		} catch { /* SSR/隐私模式：保持 classic */ }
	});

	function choose(v: Pref) {
		if (v === current) return;
		flashTransition();
		if (v === "system") resetMode();
		else setMode(v);
	}

	function chooseSkin(v: Skin) {
		if (v === skin) return;
		flashTransition();
		skin = v;
		document.documentElement.classList.toggle("theme-endfield", v === "endfield");
		try { localStorage.setItem("stelarith-skin", v); } catch { /* ignore */ }
	}

	/**
	 * 主题切换时给一次短暂的颜色过渡，避免整屏「啪」地硬切。
	 * 只在切换瞬间挂类，220ms 后摘掉；尊重 reduced-motion。
	 */
	function flashTransition() {
		if (typeof document === "undefined") return;
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		const el = document.documentElement;
		el.classList.add("theme-switching");
		window.setTimeout(() => el.classList.remove("theme-switching"), 220);
	}
</script>

<div class="flex items-center gap-1.5">
	<div
		class="flex items-center gap-0.5 rounded-md border border-border/60 p-0.5"
		role="group"
		aria-label="主题模式"
	>
		{#each OPTIONS as opt (opt.value)}
			<button
				type="button"
				class="grid size-7 cursor-pointer place-items-center rounded-[5px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
				class:bg-accent={current === opt.value}
				class:text-foreground={current === opt.value}
				aria-pressed={current === opt.value}
				title={opt.label}
				onclick={() => choose(opt.value)}
			>
				<opt.icon class="size-3.5" />
				<span class="sr-only">{opt.label}</span>
			</button>
		{/each}
	</div>

	<div
		class="flex items-center gap-0.5 rounded-md border border-border/60 p-0.5"
		role="group"
		aria-label="主题皮肤"
	>
		{#each SKINS as sk (sk.value)}
			<button
				type="button"
				class="relative grid size-7 cursor-pointer place-items-center rounded-[5px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
				class:bg-accent={skin === sk.value}
				class:text-foreground={skin === sk.value}
				aria-pressed={skin === sk.value}
				title={sk.label}
				onclick={() => chooseSkin(sk.value)}
			>
				<sk.icon class="size-3.5" />
				{#if sk.beta}
					<span
						class="pointer-events-none absolute -top-1.5 -right-1 rounded-[3px] bg-primary px-0.5 text-[7px] font-bold leading-tight text-primary-foreground"
						>β</span
					>
				{/if}
				<span class="sr-only">{sk.label}</span>
			</button>
		{/each}
	</div>
</div>
