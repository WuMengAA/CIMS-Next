<script lang="ts">
	import { onMount } from "svelte";
	import type { CardType, CardStyle, LayoutDoc } from "$lib/editor/types";
	import { serializeDoc } from "$lib/editor/types";
	import { sampleDoc } from "$lib/editor/sample";
	import { createCard } from "$lib/editor/util";
	import ComponentPalette from "$lib/components/editor/ComponentPalette.svelte";
	import EditorCanvas from "$lib/components/editor/EditorCanvas.svelte";
	import PropertyPanel from "$lib/components/editor/PropertyPanel.svelte";
import Seo from "$lib/components/Seo.svelte";

	const STORAGE_KEY = "stelarith:ui-editor";

	let doc = $state<LayoutDoc>(sampleDoc());
	let selectedId = $state<string | null>(null);
	let snap = $state(true);
	let saveStatus = $state("已保存");
	let fileInput = $state<HTMLInputElement | null>(null);
	let saveTimer: ReturnType<typeof setTimeout> | undefined;

	const selectedCard = $derived(doc.cards.find((c) => c.id === selectedId) ?? null);

	const DEVICES = [
		{ label: "桌面", width: 1024 },
		{ label: "平板", width: 768 },
		{ label: "手机", width: 390 }
	] as const;

	// ── 自动存草稿（防抖）。$effect 会深遍历 doc 代理，任何改动都触发。
	$effect(() => {
		const snapData = serializeDoc(doc);
		saveStatus = "保存中…";
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			try {
				localStorage.setItem(STORAGE_KEY, snapData);
				saveStatus = "已保存";
			} catch {
				saveStatus = "保存失败";
			}
		}, 400);
	});

	onMount(() => {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) {
				const d = JSON.parse(raw) as LayoutDoc;
				if (d && Array.isArray(d.cards) && d.canvas) doc = d;
			}
		} catch {
			/* 忽略损坏的草稿，沿用示例 */
		}
	});

	function byId(id: string) {
		return doc.cards.find((c) => c.id === id);
	}
	function snapVal(v: number): number {
		return snap ? Math.round(v / 8) * 8 : Math.round(v);
	}

	function addCard(type: CardType) {
		const n = doc.cards.length;
		const maxZ = doc.cards.reduce((m, c) => Math.max(m, c.z), 0);
		const c = createCard(type, { x: 48 + (n % 6) * 22, y: 48 + (n % 6) * 22 }, maxZ + 1);
		doc.cards.push(c);
		selectedId = c.id;
	}
	function selectCard(id: string) {
		selectedId = id;
	}
	function deselect() {
		selectedId = null;
	}
	function moveCard(id: string, x: number, y: number) {
		const c = byId(id);
		if (!c) return;
		c.x = snapVal(x);
		c.y = snapVal(y);
	}
	function resizeCard(id: string, w: number, h: number) {
		const c = byId(id);
		if (!c) return;
		c.w = snapVal(w);
		c.h = snapVal(h);
	}
	function setProp(id: string, key: string, value: unknown) {
		const c = byId(id);
		if (c) c.props[key] = value;
	}
	function setStyle(id: string, key: keyof CardStyle, value: unknown) {
		const c = byId(id);
		if (c) (c.style as Record<string, unknown>)[key] = value;
	}
	function setGeom(id: string, patch: { x?: number; y?: number; w?: number; h?: number }) {
		const c = byId(id);
		if (c) Object.assign(c, patch);
	}
	function deleteCard(id: string) {
		doc.cards = doc.cards.filter((c) => c.id !== id);
		if (selectedId === id) selectedId = null;
	}
	function bringForward(id: string) {
		const sorted = [...doc.cards].sort((a, b) => a.z - b.z);
		const i = sorted.findIndex((c) => c.id === id);
		if (i >= 0 && i < sorted.length - 1) {
			const a = sorted[i];
			const b = sorted[i + 1];
			const t = a.z;
			a.z = b.z;
			b.z = t;
		}
	}
	function sendBackward(id: string) {
		const sorted = [...doc.cards].sort((a, b) => a.z - b.z);
		const i = sorted.findIndex((c) => c.id === id);
		if (i > 0) {
			const a = sorted[i];
			const b = sorted[i - 1];
			const t = a.z;
			a.z = b.z;
			b.z = t;
		}
	}
	function setDevice(width: number) {
		doc.canvas.width = width;
	}
	function loadDoc(d: LayoutDoc) {
		doc = d;
		selectedId = null;
	}
	function clearCanvas() {
		if (!confirm("清空画布上的所有卡片？此操作不可撤销（但草稿会自动保存，可重新导入）。")) return;
		doc.cards = [];
		selectedId = null;
	}
	function exportJson() {
		const blob = new Blob([serializeDoc(doc)], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = (doc.name || "layout") + ".json";
		a.click();
		URL.revokeObjectURL(url);
	}
	function onFile(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const f = input.files?.[0];
		if (!f) return;
		const reader = new FileReader();
		reader.onload = () => {
			try {
				const d = JSON.parse(String(reader.result)) as LayoutDoc;
				if (d && Array.isArray(d.cards) && d.canvas) {
					loadDoc(d);
				} else {
					alert("格式不正确：缺少 cards 数组或 canvas。");
				}
			} catch (err) {
				alert("JSON 解析失败：" + (err as Error).message);
			}
		};
		reader.readAsText(f);
		input.value = "";
	}
</script>

<Seo title="可视化界面编辑器"
	description="可视化界面编辑器。"
	path="/editor"
	noindex
/>

<div class="editor-root">
	<header class="toolbar">
		<div class="brand">可视化界面编辑器</div>
		<label class="name">
			布局名
			<input class="name-inp" bind:value={doc.name} placeholder="未命名布局" />
		</label>

		<div class="devices">
			{#each DEVICES as d (d.width)}
				<button class="dev" class:active={doc.canvas.width === d.width} onclick={() => setDevice(d.width)}>
					{d.label}
				</button>
			{/each}
		</div>

		<label class="snap">
			<input type="checkbox" bind:checked={snap} /> 网格吸附
		</label>

		<div class="spacer"></div>

		<span class="status">{saveStatus}</span>
		<button class="btn" onclick={exportJson}>导出 JSON</button>
		<button class="btn" onclick={() => fileInput?.click()}>导入 JSON</button>
		<button class="btn ghost" onclick={clearCanvas}>清空</button>
		<input
			type="file"
			accept="application/json,.json"
			bind:this={fileInput}
			onchange={onFile}
			style="display:none"
		/>
	</header>

	<div class="body">
		<aside class="col palette-col">
			<ComponentPalette
				{doc}
				{selectedId}
				onAdd={addCard}
				onSelect={selectCard}
				onDelete={deleteCard}
				onBringForward={bringForward}
				onSendBackward={sendBackward}
			/>
		</aside>

		<main class="col canvas-col">
			<EditorCanvas {doc} {selectedId} {snap} onselect={selectCard} onmove={moveCard} onresize={resizeCard} ondeselect={deselect} />
		</main>

		<aside class="col props-col">
			<PropertyPanel card={selectedCard} onProp={setProp} onStyle={setStyle} onGeom={setGeom} onDelete={deleteCard} />
		</aside>
	</div>
</div>

<style>
	.editor-root {
		position: fixed;
		inset: 0;
		z-index: 40;
		display: flex;
		flex-direction: column;
		background: #0e0e0d;
		color: #e8e8e3;
		font-family:
			"Inter Variable", system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
	}
	.toolbar {
		height: 52px;
		flex: none;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 0 14px;
		border-bottom: 1px solid #2a2a27;
		background: #141413;
	}
	.brand {
		font-weight: 700;
		font-size: 14px;
		color: #fff;
		white-space: nowrap;
	}
	.name {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: #9a9a93;
	}
	.name-inp {
		width: 150px;
		background: #161614;
		border: 1px solid #2c2c29;
		border-radius: 8px;
		color: #e8e8e3;
		padding: 6px 9px;
		font-size: 13px;
	}
	.devices {
		display: flex;
		gap: 4px;
	}
	.dev {
		font-size: 12px;
		color: #cfcfc8;
		background: #1a1a18;
		border: 1px solid #2c2c29;
		border-radius: 8px;
		padding: 6px 11px;
		cursor: pointer;
	}
	.dev.active {
		border-color: #7c5cff;
		color: #fff;
		background: #211f2e;
	}
	.snap {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: #b8b8b0;
		white-space: nowrap;
	}
	.spacer {
		flex: 1;
	}
	.status {
		font-size: 12px;
		color: #7fbf7f;
		white-space: nowrap;
	}
	.btn {
		font-size: 13px;
		color: #fff;
		background: #7c5cff;
		border: 1px solid #7c5cff;
		border-radius: 8px;
		padding: 7px 13px;
		cursor: pointer;
		white-space: nowrap;
	}
	.btn:hover {
		filter: brightness(1.08);
	}
	.btn.ghost {
		background: transparent;
		color: #cfcfc8;
		border-color: #2c2c29;
	}
	.body {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	.col {
		height: 100%;
		min-height: 0;
	}
	.palette-col {
		width: 240px;
		flex: none;
		border-right: 1px solid #2a2a27;
		background: #121210;
	}
	.canvas-col {
		flex: 1;
		min-width: 0;
	}
	.props-col {
		width: 300px;
		flex: none;
		border-left: 1px solid #2a2a27;
		background: #121210;
	}
</style>
