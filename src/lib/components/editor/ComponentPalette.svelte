<script lang="ts">
	import type { CardType, LayoutDoc } from "$lib/editor/types";
	import { CARD_TYPES, getCardType } from "$lib/editor/card-types";
	import { Heading, Type, Image, MousePointerClick, Square, Minus, List } from "@lucide/svelte";

	let {
		doc,
		selectedId = null,
		onAdd,
		onSelect,
		onDelete,
		onBringForward,
		onSendBackward
	}: {
		doc: LayoutDoc;
		selectedId?: string | null;
		onAdd?: (type: CardType) => void;
		onSelect?: (id: string) => void;
		onDelete?: (id: string) => void;
		onBringForward?: (id: string) => void;
		onSendBackward?: (id: string) => void;
	} = $props();

	const ICONS: Record<CardType, any> = {
		heading: Heading,
		text: Type,
		image: Image,
		button: MousePointerClick,
		card: Square,
		divider: Minus,
		list: List
	};

	// 图层按 z 从高到低（顶层在上），贴合常见图层面板习惯。
	const layers = $derived([...doc.cards].sort((a, b) => b.z - a.z));

	function previewText(c: LayoutDoc["cards"][number]): string {
		const p = c.props as Record<string, string>;
		if (c.type === "heading") return p.text ?? "";
		if (c.type === "text") return p.content ?? "";
		if (c.type === "button") return p.label ?? "";
		if (c.type === "card") return p.title ?? "";
		if (c.type === "list") return (p.items ?? "").split("\n")[0] ?? "";
		return getCardType(c.type).label;
	}

	function stop(e: MouseEvent, fn: () => void) {
		e.stopPropagation();
		fn();
	}
</script>

<div class="panel">
	<section class="section">
		<h3 class="section-title">添加组件</h3>
		<div class="palette">
			{#each CARD_TYPES as t (t.type)}
				{@const Icon = ICONS[t.type]}
				<button class="palette-item" onclick={() => onAdd?.(t.type)} title="添加{t.label}">
					<Icon size={18} />
					<span>{t.label}</span>
				</button>
			{/each}
		</div>
	</section>

	<section class="section layers">
		<h3 class="section-title">图层（{doc.cards.length}）</h3>
		<div class="layer-list">
			{#each layers as c (c.id)}
				{@const Icon = ICONS[c.type]}
				<div class="layer" class:active={c.id === selectedId} onclick={() => onSelect?.(c.id)} role="button" tabindex="0">
					<Icon size={15} class="layer-icon" />
					<div class="layer-main">
						<span class="layer-name">{getCardType(c.type).label}</span>
						<span class="layer-text">{previewText(c)}</span>
					</div>
					<div class="layer-actions">
						<button class="mini" title="上移一层" onclick={(e) => stop(e, () => onBringForward?.(c.id))}>▲</button>
						<button class="mini" title="下移一层" onclick={(e) => stop(e, () => onSendBackward?.(c.id))}>▼</button>
						<button class="mini danger" title="删除" onclick={(e) => stop(e, () => onDelete?.(c.id))}>✕</button>
					</div>
				</div>
			{:else}
				<p class="empty">还没有卡片，点上方按钮添加。</p>
			{/each}
		</div>
	</section>
</div>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}
	.section {
		padding: 12px;
		border-bottom: 1px solid var(--border, #2a2a27);
	}
	.section.layers {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		border-bottom: none;
	}
	.section-title {
		margin: 0 0 10px;
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.04em;
		color: #9a9a93;
		text-transform: uppercase;
	}
	.palette {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}
	.palette-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 12px 6px;
		border-radius: 10px;
		border: 1px solid #2c2c29;
		background: #1a1a18;
		color: #e8e8e3;
		font-size: 12px;
		cursor: pointer;
		transition: border-color 0.15s, background 0.15s;
	}
	.palette-item:hover {
		border-color: #7c5cff;
		background: #211f2e;
	}
	.layer-list {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.layer {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px;
		border-radius: 8px;
		border: 1px solid transparent;
		background: #161614;
		cursor: pointer;
	}
	.layer:hover {
		border-color: #333;
	}
	.layer.active {
		border-color: #7c5cff;
		background: #211f2e;
	}
	.layer-icon {
		flex: none;
		color: #9a9a93;
	}
	.layer-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.layer-name {
		font-size: 12px;
		color: #e8e8e3;
	}
	.layer-text {
		font-size: 11px;
		color: #8a8a83;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.layer-actions {
		display: flex;
		gap: 2px;
		flex: none;
	}
	.mini {
		width: 22px;
		height: 22px;
		border-radius: 6px;
		border: 1px solid #2c2c29;
		background: #1f1f1d;
		color: #cfcfc8;
		cursor: pointer;
		font-size: 11px;
		line-height: 1;
	}
	.mini:hover {
		border-color: #555;
	}
	.mini.danger:hover {
		border-color: #c0392b;
		color: #ff8a7a;
	}
	.empty {
		font-size: 12px;
		color: #8a8a83;
		padding: 8px;
	}
</style>
