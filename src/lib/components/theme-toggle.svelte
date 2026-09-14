<script lang="ts">
	/**
	 * 主题切换：亮色 / 暗色 / 跟随系统，三态分段控件。
	 *
	 * 为什么用分段控件而不是「一个按钮循环切换」：
	 * 循环切换在只有两态时很好用，但三态下用户看不到自己「现在在哪一态」，
	 * 也点不到自己想去的态——尤其「跟随系统」是一个和亮/暗并列的独立选择，
	 * 不是亮暗之间的中间值。三个按钮把当前选择和可选项一次讲清，
	 * 且天然可键盘聚焦、可读屏（aria-pressed）。
	 *
	 * 状态来源是 `userPrefersMode`（用户的选择，含 "system"），
	 * 不是 `mode`（已经解析过的结果，"system" 会被解析成亮或暗）——
	 * 用后者的话，「跟随系统」这一态永远高亮不了。
	 */
	import { setMode, resetMode, userPrefersMode } from "mode-watcher";
	import { Sun, Moon, Monitor } from "@lucide/svelte";

	type Pref = "light" | "dark" | "system";

	const OPTIONS: { value: Pref; label: string; icon: typeof Sun }[] = [
		{ value: "light", label: "亮色", icon: Sun },
		{ value: "dark", label: "暗色", icon: Moon },
		{ value: "system", label: "跟随系统", icon: Monitor }
	];

	const current = $derived((userPrefersMode.current ?? "system") as Pref);

	function choose(v: Pref) {
		if (v === current) return;
		flashTransition();
		if (v === "system") resetMode();
		else setMode(v);
	}

	/**
	 * 主题切换时给一次短暂的颜色过渡，避免整屏「啪」地硬切。
	 * 只在切换瞬间挂类，180ms 后摘掉——常驻的话会让所有 hover 动效变迟钝。
	 * 尊重 reduced-motion：这类全站范围的过渡对前庭敏感用户不友好。
	 */
	function flashTransition() {
		if (typeof document === "undefined") return;
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		const el = document.documentElement;
		el.classList.add("theme-switching");
		window.setTimeout(() => el.classList.remove("theme-switching"), 220);
	}
</script>

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
