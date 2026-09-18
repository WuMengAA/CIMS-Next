<script lang="ts">
	/**
	 * 莱茵终端「数字滚动」——译自 RhineLabUI 所用的 @kitlangton/rolling-number
	 * 的 createRollingText：每位数字纵向滚动一格的机械翻牌，向上滚动、460ms 缓动。
	 *
	 * 为什么不直接引依赖：上游包需要 postinstall 打补丁（修正字形测量），
	 * 且体积 108K + 带 React/Solid 适配层，为文档库几个数字不值得。
	 *
	 * ⚠️ 关键：必须"先落 0，再滚到目标"才有滚动过程。
	 *   上一版直接 SSR/首帧就渲染在终值（translateY(-target)），transition 无从触发，
	 *   看起来是静止的 —— 那不叫滚动。此处：
	 *   ① 初始渲染在 0（数字带首格），SSR 输出也是 0，无水合跳变；
	 *   ② 挂载后（或 value 变化时）用 requestAnimationFrame 改到目标值，
	 *      带 transition 即产生"向上翻滚"的动画；
	 *   ③ 位与位之间按 index 错峰（transition-delay），像机械翻牌一格接一格。
	 *
	 * 尊重 prefers-reduced-motion：直接落终值，不播动画。
	 */
	import { onMount } from "svelte";

	let {
		value,
		pad = 0,
		label = "",
		delay = 0,
		stagger = 80,
		class: className = ""
	}: {
		value: number | string;
		pad?: number;
		label?: string;
		/** 整体延迟（ms），用于整块数字晚一点开始翻 */
		delay?: number;
		/** 位与位之间的错峰（ms），0 = 同时翻 */
		stagger?: number;
		class?: string;
	} = $props();

	// 目标数字（终态）；非数字字符（分隔符等）原样静态渲染
	const target = $derived.by(() => {
		const raw = String(value ?? "");
		const padded = pad > 0 ? raw.padStart(pad, "0") : raw;
		return [...padded].map((ch) => (/[0-9]/.test(ch) ? { n: Number(ch), d: true } : { n: ch, d: false }));
	});

	// 当前显示的数字位；初始全 0（第 ① 步），挂载后滚到 target（第 ② 步）
	let shown = $state<number[]>([]);
	let started = $state(false);

	const reduceMotion = () =>
		typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

	onMount(() => {
		shown = target.map((d) => (d.d ? 0 : 0));
		if (reduceMotion()) {
			shown = target.map((d) => d.n);
			started = true;
			return;
		}
		const t = setTimeout(() => {
			shown = target.map((d) => d.n);
			started = true;
		}, delay + 40);
		return () => clearTimeout(t);
	});

	// value 后续变化时重新翻滚
	$effect(() => {
		const t = target;
		if (started) {
			shown = t.map((d) => d.n);
		}
	});
</script>

<!-- 滚动数字带：外层裁切，内层 0-9 竖直排列，靠 translateY 定位 -->
<span class="{className} rhine-roll" aria-label="{label || String(value)}" role="img">
	{#each target as d, i (i)}
		{#if d.d}
			<span style="transform: translateY(-{(shown[i] ?? 0)}em); transition-delay: {delay + i * stagger}ms">
				{#each [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as n (n)}<i>{n}</i>{/each}
			</span>
		{:else}
			<span style="transform: none"><i>{d.n}</i></span>
		{/if}
	{/each}
</span>
