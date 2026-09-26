<script lang="ts">
	import type { CardModel } from "$lib/editor/types";
	import { cardStyleToCss } from "$lib/editor/style";
	import { getCardType } from "$lib/editor/card-types";

	let {
		card,
		selected = false,
		onselect,
		onmove,
		onresize
	}: {
		card: CardModel;
		selected?: boolean;
		onselect?: (id: string) => void;
		onmove?: (id: string, x: number, y: number) => void;
		onresize?: (id: string, w: number, h: number) => void;
	} = $props();

	const def = $derived(getCardType(card.type));
	const styleStr = $derived(cardStyleToCss(card.style));

	/** 业务属性取字符串（带默认）。 */
	function str(key: string, d = ""): string {
		return (card.props[key] as string) ?? d;
	}

	function startDrag(e: PointerEvent) {
		e.preventDefault();
		onselect?.(card.id);
		const sx = e.clientX;
		const sy = e.clientY;
		const ox = card.x;
		const oy = card.y;
		const move = (ev: PointerEvent) => {
			onmove?.(card.id, Math.max(0, ox + (ev.clientX - sx)), Math.max(0, oy + (ev.clientY - sy)));
		};
		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	}

	function startResize(e: PointerEvent) {
		e.preventDefault();
		e.stopPropagation();
		onselect?.(card.id);
		const sx = e.clientX;
		const sy = e.clientY;
		const ow = card.w;
		const oh = card.h;
		const move = (ev: PointerEvent) => {
			onresize?.(card.id, Math.max(40, ow + (ev.clientX - sx)), Math.max(24, oh + (ev.clientY - sy)));
		};
		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	}
</script>

<div
	class="card-wrapper"
	class:selected
	style="position:absolute; left:{card.x}px; top:{card.y}px; width:{card.w}px; height:{card.h}px; z-index:{card.z};"
	onpointerdown={startDrag}
	role="button"
	tabindex="0"
	aria-label={def.label}
>
	<div class="card-body" style={styleStr}>
		{#if card.type === "heading"}
			<div class="h-text">{str("text") || "标题"}</div>
		{:else if card.type === "text"}
			<div class="t-text">{str("content")}</div>
		{:else if card.type === "image"}
			{#if str("src")}
				<img class="img" src={str("src")} alt={str("alt")} style="object-fit:{str('objectFit', 'cover')}" />
			{:else}
				<div class="placeholder">图片占位<br /><span>{str("alt") || "未设置地址"}</span></div>
			{/if}
		{:else if card.type === "button"}
			{@const variant = str("variant", "primary")}
			<a
				class="btn"
				href={str("href", "#")}
				style={variant === "primary"
					? "background:#7c5cff;color:#fff;border:1px solid #7c5cff;"
					: variant === "outline"
						? "background:transparent;color:#ddd;border:1px solid #666;"
						: "background:#333;color:#eee;border:1px solid #444;"}
			>
				{str("label", "按钮")}
			</a>
		{:else if card.type === "card"}
			<div class="card-title">{str("title")}</div>
			<div class="card-slot">（容器卡片，可继续编排内容）</div>
		{:else if card.type === "divider"}
			<hr class="hr" style="border-top-width:{str('thickness', '2')}px;border-top-color:{str('color', '#444')};" />
		{:else if card.type === "list"}
			<ul class="ul">
				{#each str("items").split("\n") as li}
					{#if li.trim()}<li>{li}</li>{/if}
				{/each}
			</ul>
		{/if}
	</div>

	{#if selected}
		<div class="resize-handle" onpointerdown={startResize} title="拖拽缩放"></div>
	{/if}
</div>

<style>
	.card-wrapper {
		box-sizing: border-box;
		cursor: move;
		touch-action: none;
		outline: 1px dashed rgba(255, 255, 255, 0.18);
		outline-offset: 1px;
	}
	.card-wrapper:hover {
		outline-color: rgba(255, 255, 255, 0.4);
	}
	.card-wrapper.selected {
		outline: 2px solid #7c5cff;
		outline-offset: 1px;
	}
	.card-body {
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		justify-content: center;
		pointer-events: none; /* 内容区不拦截，点击/拖拽都落到 wrapper */
	}
	.h-text {
		width: 100%;
		line-height: 1.2;
		word-break: break-word;
	}
	.t-text {
		width: 100%;
		white-space: pre-wrap;
		line-height: 1.6;
		word-break: break-word;
	}
	.img {
		width: 100%;
		height: 100%;
		display: block;
		border-radius: inherit;
	}
	.placeholder {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
		color: #9a9a93;
		font-size: 13px;
		background: repeating-linear-gradient(45deg, #202020, #202020 10px, #262626 10px, #262626 20px);
	}
	.btn {
		pointer-events: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		padding: 0 18px;
		border-radius: 8px;
		text-decoration: none;
		font-weight: 600;
		font-size: 14px;
		white-space: nowrap;
	}
	.card-title {
		font-weight: 700;
		font-size: 15px;
		margin-bottom: 6px;
	}
	.card-slot {
		font-size: 12px;
		opacity: 0.6;
	}
	.hr {
		width: 100%;
		margin: 0;
		border: none;
		border-top: 2px solid #444;
	}
	.ul {
		margin: 0;
		padding-left: 1.2em;
		line-height: 1.7;
	}
	.resize-handle {
		position: absolute;
		right: -7px;
		bottom: -7px;
		width: 14px;
		height: 14px;
		border-radius: 3px;
		background: #7c5cff;
		border: 2px solid #fff;
		cursor: nwse-resize;
		pointer-events: auto;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
	}
</style>
