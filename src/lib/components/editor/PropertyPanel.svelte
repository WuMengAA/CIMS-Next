<script lang="ts">
	import type { CardModel, CardStyle } from "$lib/editor/types";
	import { getCardType, type FieldDef } from "$lib/editor/card-types";
	import { STYLE_FIELDS } from "$lib/editor/style";

	let {
		card,
		onProp,
		onStyle,
		onGeom,
		onDelete
	}: {
		card: CardModel | null;
		onProp?: (id: string, key: string, value: unknown) => void;
		onStyle?: (id: string, key: keyof CardStyle, value: unknown) => void;
		onGeom?: (id: string, patch: { x?: number; y?: number; w?: number; h?: number }) => void;
		onDelete?: (id: string) => void;
	} = $props();

	function isHex(v: unknown): v is string {
		return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
	}
	function toNum(e: Event): number | null {
		const v = parseFloat((e.currentTarget as HTMLInputElement).value);
		return Number.isNaN(v) ? null : v;
	}
	function colorVal(v: unknown): string {
		return isHex(v) ? v : "#000000";
	}
</script>

{#if !card}
	<div class="empty">在画布中点选一张卡片，<br />即可在此编辑它的内容与样式。</div>
{:else}
	{@const def = getCardType(card.type)}
	<div class="panel">
		<div class="head">
			<span class="badge">{def.label}</span>
			<button class="del" onclick={() => onDelete?.(card.id)}>删除</button>
		</div>

		<!-- 位置与尺寸 -->
		<section class="group">
			<h4>位置与尺寸</h4>
			<div class="grid2">
				<label class="f">X<input class="inp" type="number" value={card.x} oninput={(e) => { const n = toNum(e); if (n != null) onGeom?.(card.id, { x: n }); }} /></label>
				<label class="f">Y<input class="inp" type="number" value={card.y} oninput={(e) => { const n = toNum(e); if (n != null) onGeom?.(card.id, { y: n }); }} /></label>
				<label class="f">宽<input class="inp" type="number" value={card.w} oninput={(e) => { const n = toNum(e); if (n != null) onGeom?.(card.id, { w: n }); }} /></label>
				<label class="f">高<input class="inp" type="number" value={card.h} oninput={(e) => { const n = toNum(e); if (n != null) onGeom?.(card.id, { h: n }); }} /></label>
			</div>
		</section>

		<!-- 内容属性 -->
		<section class="group">
			<h4>内容</h4>
			{#each def.fields as f (f.key)}
				<label class="f block">
					<span class="lab">{f.label}</span>
					{#if f.control === "textarea" || f.control === "list"}
						<textarea
							class="inp area"
							rows="4"
							placeholder={f.placeholder}
							value={(card.props[f.key] as string) ?? ""}
							oninput={(e) => onProp?.(card.id, f.key, (e.currentTarget as HTMLTextAreaElement).value)}
						></textarea>
					{:else if f.control === "select"}
						<select class="inp" value={(card.props[f.key] as string) ?? ""} onchange={(e) => onProp?.(card.id, f.key, (e.currentTarget as HTMLSelectElement).value)}>
							{#each f.options ?? [] as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
						</select>
					{:else}
						<input
							class="inp"
							type={f.control === "number" ? "number" : f.control === "url" ? "url" : "text"}
							placeholder={f.placeholder}
							value={(card.props[f.key] as string) ?? ""}
							oninput={(e) => onProp?.(card.id, f.key, (e.currentTarget as HTMLInputElement).value)}
						/>
					{/if}
				</label>
			{/each}
		</section>

		<!-- 样式 -->
		<section class="group">
			<h4>样式</h4>
			{#each STYLE_FIELDS as sf (sf.key)}
				<label class="f block">
					<span class="lab">{sf.label}</span>
					{#if sf.control === "color"}
						<span class="color-row">
							<input
								class="color"
								type="color"
								value={colorVal(card.style[sf.key])}
								oninput={(e) => onStyle?.(card.id, sf.key, (e.currentTarget as HTMLInputElement).value)}
							/>
							<button class="clear" onclick={() => onStyle?.(card.id, sf.key, "")} title="清除">无</button>
						</span>
					{:else if sf.control === "toggle"}
						<input type="checkbox" checked={!!card.style[sf.key]} onchange={(e) => onStyle?.(card.id, sf.key, (e.currentTarget as HTMLInputElement).checked)} />
					{:else if sf.control === "select"}
						<select class="inp" value={(card.style[sf.key] as string) ?? ""} onchange={(e) => onStyle?.(card.id, sf.key, (e.currentTarget as HTMLSelectElement).value)}>
							{#each sf.options ?? [] as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
						</select>
					{:else}
						<input
							class="inp"
							type="number"
							min={sf.min}
							max={sf.max}
							step={sf.step ?? 1}
							value={card.style[sf.key] ?? ""}
							oninput={(e) => { const n = toNum(e); if (n != null) onStyle?.(card.id, sf.key, n); }}
						/>
					{/if}
				</label>
			{/each}
		</section>
	</div>
{/if}

<style>
	.empty {
		padding: 24px 16px;
		font-size: 13px;
		line-height: 1.7;
		color: #8a8a83;
	}
	.panel {
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		height: 100%;
		overflow-y: auto;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 8px;
	}
	.badge {
		font-size: 12px;
		font-weight: 600;
		color: #fff;
		background: #7c5cff;
		border-radius: 999px;
		padding: 3px 10px;
	}
	.del {
		font-size: 12px;
		color: #ff8a7a;
		background: transparent;
		border: 1px solid #5a2a2a;
		border-radius: 8px;
		padding: 4px 10px;
		cursor: pointer;
	}
	.del:hover {
		background: #2a1414;
	}
	.group {
		border-top: 1px solid #2a2a27;
		padding: 12px 0;
	}
	.group h4 {
		margin: 0 0 10px;
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.04em;
		color: #9a9a93;
		text-transform: uppercase;
	}
	.grid2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}
	.f {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: #b8b8b0;
	}
	.f.block {
		flex-direction: column;
		align-items: stretch;
		gap: 5px;
		margin-bottom: 10px;
	}
	.lab {
		font-size: 12px;
		color: #b8b8b0;
	}
	.inp {
		width: 100%;
		box-sizing: border-box;
		background: #161614;
		border: 1px solid #2c2c29;
		border-radius: 8px;
		color: #e8e8e3;
		padding: 7px 9px;
		font-size: 13px;
	}
	.inp:focus {
		outline: none;
		border-color: #7c5cff;
	}
	.area {
		resize: vertical;
		font-family: inherit;
		line-height: 1.5;
	}
	.color-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.color {
		width: 40px;
		height: 30px;
		padding: 0;
		border: 1px solid #2c2c29;
		border-radius: 8px;
		background: #161614;
		cursor: pointer;
	}
	.clear {
		font-size: 12px;
		color: #8a8a83;
		background: transparent;
		border: 1px solid #2c2c29;
		border-radius: 8px;
		padding: 5px 10px;
		cursor: pointer;
	}
</style>
