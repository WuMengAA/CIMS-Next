<script lang="ts">
	/**
	 * 莱茵终端「数字滚动」——翻译自 RhineLabUI 所用的 @kitlangton/rolling-number
	 * 的 createRollingText：每位数字纵向滚动一格的机械翻牌，向上滚动、460ms 缓动。
	 *
	 * 为什么不直接引依赖：上游包需要 postinstall 打补丁（修正字形测量），
	 * 且体积 108K + 带 React/Solid 适配层，为文档库两个数字不值得。
	 * 这里用纯 CSS transform 复刻同一观感：每位一列 0-9 的数字带，
	 * 用 translateY(-d * 1em) 定位到目标数字，切换时带 transition 即产生滚动。
	 */
	let {
		value,
		pad = 0,
		label = "",
		class: className = ""
	}: { value: number | string; pad?: number; label?: string; class?: string } = $props();

	// 数字拆成单字符；非数字字符（分隔符等）原样静态渲染
	const digits = $derived.by(() => {
		const raw = String(value ?? "");
		const padded = pad > 0 ? raw.padStart(pad, "0") : raw;
		return [...padded].map((ch) => (/[0-9]/.test(ch) ? { n: Number(ch), d: true } : { n: ch, d: false }));
	});
</script>

<!-- 滚动数字带：外层裁切，内层 0-9 竖直排列 -->
<span class="{className} rhine-roll" aria-label="{label || String(value)}" role="img">
	{#each digits as d, i (i)}
		{#if d.d}
			<span style="transform: translateY(-{d.n}em)">
				{#each [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as n (n)}<i>{n}</i>{/each}
			</span>
		{:else}
			<span style="transform: none"><i>{d.n}</i></span>
		{/if}
	{/each}
</span>
