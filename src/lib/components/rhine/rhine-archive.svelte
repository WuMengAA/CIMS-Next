<!--
  Rhinelab 原版档案墙 —— SvelteKit 宿主
  ================================================================================
  这是把 RhineLabUI（vanilla Three.js）原版文档选择界面收编进我们站点的宿主组件。
  引擎（ArchiveScene + 23 个模块 + GLTF 资产）原样运行在右侧 canvas，
  这个组件只负责：
    · 拿到服务端下发 docs → buildArchiveContent 整形 → setContent 注入引擎
    · 在宿主 div 上 new ArchiveScene + 每帧 update() 驱动
    · 接明暗主题（scene.setTheme）、载入/释放（dispose）
    · 档案选择 → onOpen 打开 /docs/[slug]（原版的"读取"动作接到我们详情页）
    · 右侧档案摘要抽屉（原版 inspection overlay 的简化版）
-->
<script lang="ts">
	import { onMount } from "svelte";
	import { CornerDownLeft } from "@lucide/svelte";
	import { mode } from "mode-watcher";
	import { buildArchiveContent, type DocInput } from "$lib/rhinelab/archive-content";
	import { setContent, columnFiles, fileLocation, type ArchiveRecord } from "$lib/rhinelab/data";
	import { wrap } from "$lib/rhinelab/archive-loop";

	type Props = {
		/** 后端下发的教程列表 */
		docs: DocInput[];
		onOpen?: (href: string) => void;
	};

	let { docs = [], onOpen }: Props = $props();

	let hostEl: HTMLDivElement | undefined = $state();
	let webglFailed = $state(false);
	let ready = $state(false);

	let scene: any = null;
	let lastTick = 0;
	let raf = 0;

	// 当前选中档案（HUD 显示用）
	let selectedRecord: ArchiveRecord | null = $state(null);
	let selectedIndex = $state(0);

	const content = $derived(buildArchiveContent(docs ?? []));
	const columnCount = $derived(content?.columns.length ?? 0);

	// 每一列最近一次选中哪份档案（切列回来时回到该列上次的位置）
	let columnMemory: Record<number, number> = {};

	function openCurrent() {
		const rec = selectedRecord;
		if (!rec) return;
		const href = rec.source || `/docs/${rec.slug}`;
		if (onOpen) onOpen(href);
		else if (typeof window !== "undefined") window.location.href = href;
	}

	/** 切换档案（flat index） */
	function pick(index: number, navigation?: any) {
		if (!scene || !content) return;
		const total = content.records.length;
		selectedIndex = ((index % total) + total) % total;
		columnMemory[fileLocation(selectedIndex).lane] = selectedIndex;
		scene.select(selectedIndex, navigation);
		selectedRecord = content.records[selectedIndex] ?? null;
	}

	/** 上下：列内切档 */
	function stepFile(direction: number) {
		if (!content) return;
		const lane = fileLocation(selectedIndex).lane;
		const files = columnFiles(lane);
		if (files.length < 2) return;
		pick(
			files[(files.indexOf(selectedIndex) + direction + files.length) % files.length],
			{ axis: "row", direction }
		);
	}

	/** 左右：切列 */
	function stepColumn(direction: number) {
		if (!content) return;
		const lane = fileLocation(selectedIndex).lane;
		const next = wrap(lane + direction, columnCount);
		pick(columnMemory[next] ?? 0, { axis: "lane", direction });
	}

	function onKeydown(e: KeyboardEvent) {
		const el = e.target as HTMLElement | null;
		if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
		if (el?.isContentEditable) return;
		switch (e.key) {
			case "ArrowLeft":
			case "a":
			case "A":
				e.preventDefault();
				stepColumn(-1);
				break;
			case "ArrowRight":
			case "d":
			case "D":
				e.preventDefault();
				stepColumn(1);
				break;
			case "ArrowUp":
			case "w":
			case "W":
				e.preventDefault();
				stepFile(-1);
				break;
			case "ArrowDown":
			case "s":
			case "S":
				e.preventDefault();
				stepFile(1);
				break;
			case "Enter":
				e.preventDefault();
				openCurrent();
				break;
		}
	}

	onMount(() => {
		let disposed = false;
		if (!hostEl) return;
		// 键盘导航（引擎不监听按键，主机层负责把方向键换算成 pick）
		window.addEventListener("keydown", onKeydown);

		(async () => {
			if (!content) return;
			// 注入数据
			setContent(content);

			// 动态 import：three + 引擎只在客户端加载
			try {
				const { ArchiveScene } = await import("$lib/rhinelab/scene");
				if (disposed || !hostEl) return;

				scene = new ArchiveScene(hostEl);
				scene.setReduced(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true);
				scene.setTheme(mode.current === "dark", true);

				// 档案选择（含方向键导航后的 onSelect 回调整合）
				scene.onSelect = (i: number) => {
					selectedIndex = i;
					selectedRecord = content.records[i] ?? null;
				};
				scene.onHover = () => {};

				// static/rhinelab/ 始终部署在站点根；asset-url 用 BASE_URL 拼，但 GLTFLoader
				// 对以 / 开头的绝对路径不会拼页面目录。这里显式写根路径。
				await scene.load("/rhinelab/archive-cassette.glb");
				if (disposed || !hostEl) return;

				scene.setMode("archive");
				scene.select(0);
				// 初始选中第一份档案（HUD 抽屉立即可见，不必等用户交互）
				selectedIndex = 0;
				selectedRecord = content.records[0] ?? null;

				// 每帧驱动
				let last = 0;
				function tick(ms: number) {
					if (disposed) return;
					raf = requestAnimationFrame(tick);
					const t = ms / 1000;
					if (last === 0) last = t;
					scene?.update(t, undefined);
					last = t;
				}
				raf = requestAnimationFrame(tick);
				ready = true;
			} catch (err) {
				console.error("[rhinelab] 引擎初始化失败", err);
				webglFailed = true;
			}
		})();

		// 尺寸自适应交给引擎内部（它监听 ResizeObserver）
		// 主题切换
		const cleanup = () => {
			disposed = true;
			cancelAnimationFrame(raf);
			window.removeEventListener("keydown", onKeydown);
			scene?.dispose?.();
			scene = null;
		};
		return cleanup;
	});

	$effect(() => {
		// 主题跟随
		if (!scene || !ready) return;
		scene.setTheme?.(mode.current === "dark", false);
	});
</script>

<div class="rhine-hall">
	<div class="rhine-canvas-host" bind:this={hostEl}></div>

	<!-- 载入遮罩 -->
	<div class="rhine-hall-veil" data-ready={ready}></div>

	{#if webglFailed}
		<div class="rhine-hall-fallback">
			<p>当前环境不支持三维渲染（WebGL 不可用）。</p>
			<ul>
				{#each docs as d (d.slug)}
					<li><a href={`/docs/${d.slug}`}>{d.title}</a></li>
				{/each}
			</ul>
		</div>
	{/if}

	<!-- HUD：左侧标题栏 -->
	<div class="rhine-hud">
		<div class="rhine-hud-title">
			<span class="rhine-label">INTERNAL DATABASE / 教程库</span>
			<span class="rhine-hud-count">
				{String(selectedIndex + 1).padStart(3, "0")} / {String(content?.records.length ?? 0).padStart(3, "0")}
			</span>
		</div>

		<!-- 中间操作提示 -->
		<div class="rhine-hud-hint">← → 切换列 · ↑ ↓ 换档案 · Enter 读取</div>

		<!-- 右侧档案抽屉（原版 inspection 简化） -->
		{#if selectedRecord}
			<div class="rhine-callout">
				<div class="rhine-callout-head">
					<span class="rhine-label">FILE {selectedRecord.id}</span>
					<span class="rhine-callout-clearance">{selectedRecord.clearance}</span>
				</div>
				<div class="rhine-callout-en">{selectedRecord.en}</div>
				<div class="rhine-callout-title">{selectedRecord.title}</div>
				<p class="rhine-callout-abstract">{selectedRecord.abstract}</p>
				<div class="rhine-callout-meta">
					<span>{selectedRecord.department}</span>
					<span>{selectedRecord.date}</span>
				</div>
				<button type="button" class="rhine-read" onclick={openCurrent}>
					<CornerDownLeft size={13} />
					<span>读取档案</span>
					<kbd>Enter</kbd>
				</button>
			</div>
		{/if}
	</div>
</div>

<style>
	.rhine-hall {
		position: relative;
		width: 100%;
		height: clamp(480px, 72vh, 800px);
		overflow: hidden;
		background: var(--rhine-paper, #eae5e1);
		border: 1px solid var(--rhine-line, #aaa59a);
	}
	.rhine-canvas-host {
		position: absolute;
		inset: 0;
	}
	.rhine-canvas-host :global(canvas) {
		display: block;
		width: 100%;
		height: 100%;
	}

	.rhine-hall-veil {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: var(--rhine-paper, #eae5e1);
		clip-path: inset(0 0 100% 0);
		transition: clip-path 0.9s cubic-bezier(0.16, 1, 0.3, 1) 0.15s;
	}
	.rhine-hall-veil[data-ready="true"] {
		clip-path: inset(0 0 0 0);
	}

	.rhine-hud {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}
	.rhine-hud-title {
		position: absolute;
		top: 14px;
		left: 14px;
		right: 14px;
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}
	.rhine-hud-count {
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 13px;
		color: var(--rhine-label, #6d6a60);
		letter-spacing: 0.06em;
	}
	.rhine-hud-hint {
		position: absolute;
		left: 14px;
		bottom: 14px;
		font-size: 11px;
		color: var(--rhine-label, #6d6a60);
		opacity: 0.85;
		letter-spacing: 0.04em;
	}

	.rhine-callout {
		position: absolute;
		right: 14px;
		top: 50%;
		transform: translateY(-50%);
		pointer-events: auto;
		width: min(300px, 28vw);
		padding: 14px 16px;
		background: color-mix(in srgb, var(--rhine-paper, #f2efe9) 88%, transparent);
		border: 1px solid var(--rhine-line, #aaa59a);
		border-left: 2px solid var(--rhine-accent, #9b7247);
		backdrop-filter: blur(10px);
		box-shadow: 0 10px 28px rgba(0, 0, 0, 0.14);
	}
	.rhine-callout-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding-bottom: 8px;
		border-bottom: 1px solid var(--rhine-line-strong, #d8d2cb);
		margin-bottom: 8px;
	}
	.rhine-callout-clearance {
		font-size: 10px;
		letter-spacing: 0.1em;
		color: var(--rhine-accent, #9b7247);
	}
	.rhine-callout-en {
		font-size: 11px;
		letter-spacing: 0.14em;
		color: var(--rhine-muted, #77756d);
		margin-bottom: 4px;
	}
	.rhine-callout-title {
		font-size: 15px;
		font-weight: 600;
		color: var(--rhine-ink, #080a08);
		line-height: 1.35;
		margin-bottom: 8px;
	}
	.rhine-callout-abstract {
		font-size: 12px;
		line-height: 1.55;
		color: var(--rhine-muted, #77756d);
		display: -webkit-box;
		-webkit-line-clamp: 4;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.rhine-callout-meta {
		display: flex;
		gap: 10px;
		margin: 8px 0;
		font-size: 11px;
		color: var(--rhine-muted, #77756d);
	}
	.rhine-read {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		font-size: 12px;
		border: 1px solid var(--rhine-accent, #9b7247);
		color: var(--rhine-accent, #9b7247);
		background: transparent;
		cursor: pointer;
		transition: all 0.2s ease;
	}
	.rhine-read:hover {
		background: var(--rhine-accent, #9b7247);
		color: var(--rhine-paper, #f2efe9);
	}
	.rhine-read kbd {
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 10px;
		border: 1px solid currentColor;
		padding: 0 3px;
		opacity: 0.7;
	}

	.rhine-hall-fallback {
		position: absolute;
		inset: 0;
		overflow: auto;
		padding: 16px;
		background: var(--rhine-paper, #eae5e1);
		font-size: 13px;
	}
</style>