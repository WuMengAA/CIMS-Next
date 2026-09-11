<script lang="ts">
	/**
	 * 前台 / 后台 分段滑块。
	 *
	 * - 纯 CSS 滑动指示块（translateX + 过渡），`prefers-reduced-motion` 下自动取消动画。
	 * - 用 `<a>` 承载，天然支持中键新开、键盘 Tab + Enter，无需 JS 导航。
	 * - 遵循 design.md：rounded-lg、border-border/60、字重上限 font-medium、
	 *   视觉克制（1px 边框 + 轻投影表达层级，不用重阴影）。
	 */
	import { Globe, LayoutDashboard } from "@lucide/svelte";
	import { cn } from "$lib/utils.js";

	let {
		current = "site",
		adminHref = "/admin",
		class: className
	}: {
		current?: "site" | "admin";
		adminHref?: string;
		class?: string;
	} = $props();

	const options = [
		{ id: "site" as const, label: "前台", href: "/", icon: Globe },
		{ id: "admin" as const, label: "后台", href: adminHref, icon: LayoutDashboard }
	];

	const index = $derived(current === "admin" ? 1 : 0);
</script>

<nav
	class={cn(
		"relative flex items-center rounded-lg border border-border/60 bg-muted/40 p-0.5",
		className
	)}
	aria-label="前台 / 后台切换"
>
	<!-- 滑动指示块：宽度 = 50% - 内边距，位移 100% 恰好落在第二格 -->
	<span
		class="pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc(50%-0.125rem)] rounded-md bg-background shadow-sm ring-1 ring-border/60 transition-transform duration-200 ease-out motion-reduce:transition-none"
		style="transform: translateX({index === 1 ? '100%' : '0%'})"
		aria-hidden="true"
	></span>

	{#each options as opt, i (opt.id)}
		<a
			href={opt.href}
			aria-current={index === i ? "page" : undefined}
			class={cn(
				"relative z-10 flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors",
				index === i ? "text-foreground" : "text-muted-foreground hover:text-foreground"
			)}
		>
			<opt.icon class="size-3.5 shrink-0" />
			<span class="truncate">{opt.label}</span>
		</a>
	{/each}
</nav>
