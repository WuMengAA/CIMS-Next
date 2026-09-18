<script lang="ts">
	/**
	 * 莱茵终端「开机打字」——终端逐字显现。
	 *
	 * 用 CSS clip-path + steps() 做逐字揭开（无需 JS 计时器，SSR 即可出正确终态），
	 * 光标用 steps(1) 闪烁。字数通过 --rhine-chars 传给 CSS，让 steps 与字数对齐，
	 * 否则步数固定会让长短文本的节奏不一致。
	 *
	 * delayStart：整段打字开始的延迟（毫秒），用于多行依次输入的错峰。
	 * 尊重 prefers-reduced-motion（动画在 CSS 里被关掉，直接显示全文）。
	 */
	let {
		text,
		duration = 1100,
		delayStart = 0,
		class: className = "",
		as = "span"
	}: {
		text: string;
		duration?: number;
		delayStart?: number;
		class?: string;
		as?: "span" | "div";
	} = $props();

	// 步数按「非空白字符数」算，空格不占一拍，节奏更像真实打字
	const steps = $derived(Math.max(1, text.replace(/\s/g, "").length));
</script>

<svelte:element
	this={as}
	class="{className} rhine-typing"
	style="--rhine-chars:{steps}; animation-duration: {duration}ms, 0.72s; animation-delay: {delayStart}ms, 0ms;"
>{text}</svelte:element>
