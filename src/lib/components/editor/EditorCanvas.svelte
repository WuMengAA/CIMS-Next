<script lang="ts">
	import type { LayoutDoc } from "$lib/editor/types";
	import CardView from "./CardView.svelte";

	let {
		doc,
		selectedId = null,
		snap = false,
		onselect,
		onmove,
		onresize,
		ondeselect
	}: {
		doc: LayoutDoc;
		selectedId?: string | null;
		snap?: boolean;
		onselect?: (id: string) => void;
		onmove?: (id: string, x: number, y: number) => void;
		onresize?: (id: string, w: number, h: number) => void;
		ondeselect?: () => void;
	} = $props();

	function onCanvasPointerDown(e: PointerEvent) {
		// 只有点到画布本身（空白）才取消选中；点到卡片由 CardView 处理。
		if (e.target === e.currentTarget) ondeselect?.();
	}
</script>

<div class="canvas-area" onpointerdown={onCanvasPointerDown}>
	<div
		class="canvas"
		class:snap
		style="width:{doc.canvas.width}px; height:{doc.canvas.height}px; background-color:{doc.canvas.background};"
	>
		{#each doc.cards as card (card.id)}
			<CardView {card} selected={card.id === selectedId} {onselect} {onmove} {onresize} />
		{/each}
	</div>
</div>

<style>
	.canvas-area {
		flex: 1;
		min-width: 0;
		overflow: auto;
		padding: 32px;
		background:
			radial-gradient(circle at 30% 20%, rgba(124, 92, 255, 0.08), transparent 60%),
			#0e0e0d;
	}
	.canvas {
		position: relative;
		margin: 0 auto;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
		outline: 1px solid rgba(255, 255, 255, 0.06);
	}
	.canvas.snap {
		background-image:
			linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px),
			linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px);
		background-size: 8px 8px;
	}
</style>
