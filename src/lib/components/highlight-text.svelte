<script lang="ts">
	/**
	 * 在纯文本里高亮命中区间。
	 *
	 * 关键点：这里接收的 text 是**纯文本**（服务端已剥离 Markdown），
	 * ranges 是字符偏移量。组件把它们切成片段后用普通文本插值渲染，
	 * 依赖 Svelte 默认的 HTML 转义，全程不用 {@html}，因此对内容里的
	 * `<script>` 之类完全免疫。
	 */
	interface Props {
		text: string;
		ranges?: { start: number; end: number }[];
	}

	let { text, ranges = [] }: Props = $props();

	const parts = $derived.by(() => {
		const out: { text: string; hit: boolean }[] = [];
		if (!text) return out;
		if (!ranges.length) return [{ text, hit: false }];
		let cur = 0;
		for (const r of ranges) {
			const s = Math.max(0, Math.min(r.start, text.length));
			const e = Math.max(s, Math.min(r.end, text.length));
			if (s > cur) out.push({ text: text.slice(cur, s), hit: false });
			if (e > s) out.push({ text: text.slice(s, e), hit: true });
			cur = Math.max(cur, e);
		}
		if (cur < text.length) out.push({ text: text.slice(cur), hit: false });
		return out;
	});
</script>

<span
	>{#each parts as p, i (i)}{#if p.hit}<mark class="rounded-sm bg-primary/25 px-0.5 text-foreground">{p.text}</mark>{:else}{p.text}{/if}{/each}</span
>
