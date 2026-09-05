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

	// Icon morphs between Menu (closed) and PanelLeft (open)
	const currentIcon = $derived(sidebar.open ? PanelLeft : Menu);
</script>

<Button
	bind:ref
	data-sidebar="trigger"
	data-slot="sidebar-trigger"
	variant="ghost"
	size="icon-sm"
	class={cn("cn-sidebar-trigger", className)}
	type="button"
	onclick={(e) => {
		onclick?.(e);
		sidebar.toggle();
	}}
	{...restProps}
>
	<MorphIcon icon={currentIcon} spring="snappy"  size={18} aria-hidden="true" />
	<span class="sr-only">Toggle Sidebar</span>
</Button>