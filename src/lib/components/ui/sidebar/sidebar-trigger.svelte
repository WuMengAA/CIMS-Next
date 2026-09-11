<script lang="ts">
	import { MorphIcon } from "morphicons/svelte";
	import { Menu, PanelLeft, X } from "lucide"; // data, not components
	import { Button } from "$lib/components/ui/button/index.js";
	import { cn } from "$lib/utils.js";
	import { useSidebar } from "./context.svelte.js";
	import type { ComponentProps } from "svelte";

	let {
		ref = $bindable(null),
		class: className,
		onclick,
		...restProps
	}: ComponentProps<typeof Button> & {
		onclick?: (e: MouseEvent) => void;
	} = $props();

	const sidebar = useSidebar();

	// 图标语义 = 「按下会发生什么」：
	//  · 窄屏：开合浮层抽屉，恒用汉堡图标——抽屉展开时按钮已被遮罩盖住，切图无意义，
	//          且直接读 sidebar.open（桌面折叠态）会误显示 PanelLeft，误导用户以为已展开。
	//  · 桌面：收起/展开侧栏，PanelLeft 表示「将收起」，Menu 表示「将展开」。
	const currentIcon = $derived(!sidebar.isMobile && sidebar.open ? PanelLeft : Menu);
</script>

<Button
	bind:ref
	data-sidebar="trigger"
	data-slot="sidebar-trigger"
	variant="ghost"
	size="icon-sm"
	class={cn("cn-sidebar-trigger", className)}
	type="button"
	onclick={(e: MouseEvent) => {
		onclick?.(e);
		sidebar.toggle();
	}}
	{...restProps}
>
	<MorphIcon icon={currentIcon} spring="snappy"  size={18} aria-hidden="true" />
	<span class="sr-only">Toggle Sidebar</span>
</Button>