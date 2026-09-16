<script lang="ts">
	/**
	 * 侧边栏拖拽手柄 —— 桌面端可推拉侧栏宽度。
	 *
	 * 必须放在 <Sidebar.Root> 内部（需要 sidebar context）：
	 * - 移动端 / 折叠图标态不显示（移动端走抽屉，图标态宽度固定）。
	 * - pointerdown 后跟踪 pointermove 更新共享宽度，内容区随 CSS 变量自适应。
	 */
	import { useSidebar } from "$lib/components/ui/sidebar/index.js";
	import { getSidebarWidthPx, setSidebarWidth } from "$lib/sidebar-width.svelte.js";

	const sidebar = useSidebar();

	function onResizeStart(e: PointerEvent) {
		if (e.button !== 0) return;
		// 图标折叠态不可拖拽（宽度固定为 icon rail）
		if (sidebar.state === "collapsed") return;
		e.preventDefault();
		const startX = e.clientX;
		const startW = getSidebarWidthPx();
		const onMove = (ev: PointerEvent) => {
			setSidebarWidth(startW + (ev.clientX - startX));
		};
		const onUp = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
		};
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	}
</script>

{#if !sidebar.isMobile}
	<div
		class="sidebar-resizer group-data-[state=collapsed]:hidden"
		role="separator"
		aria-orientation="vertical"
		title="拖拽调整侧栏宽度"
		onpointerdown={onResizeStart}
	>
		<div class="sidebar-resizer-thumb" />
	</div>
{/if}

<style>
	/* 手柄挂在侧栏右缘：只占 4px 宽，悬停/拖动时高亮成一条可抓取的线 */
	.sidebar-resizer {
		position: absolute;
		top: 0;
		bottom: 0;
		right: 0;
		z-index: 30;
		width: 4px;
		cursor: col-resize;
		touch-action: none;
	}
	.sidebar-resizer-thumb {
		position: absolute;
		inset-block: 0;
		left: 1px;
		width: 2px;
		background: transparent;
		transition: background-color 0.15s ease;
	}
	.sidebar-resizer:hover .sidebar-resizer-thumb,
	.sidebar-resizer:active .sidebar-resizer-thumb {
		background: var(--primary, oklch(0.6 0.15 270));
		opacity: 0.7;
	}
</style>
