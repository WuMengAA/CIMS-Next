<script lang="ts">
	/**
	 * 前台 / 后台 分段滑块。
	 *
	 * - 纯 CSS 滑动指示块（translateX + 过渡），`prefers-reduced-motion` 下自动取消动画。
	 * - 用 `<a>` 承载，天然支持中键新开、键盘 Tab + Enter，无需 JS 导航。
	 * - 遵循 design.md：rounded-lg、border-border/60、字重上限 font-medium、
	 *   视觉克制（1px 边框 + 轻投影表达层级，不用重阴影）。
	 *
	 * 动效设计：
	 *  1. 指示块用 ease-out 的 cubic-bezier（比默认 ease 更有"到位即停"的手感），
	 *     时长 220ms —— 分段控件太快显得跳、太慢显得拖。
	 *  2. 图标做微幅缩放：当前项 1 → 1.08，配合颜色变化强化"选中"的即时反馈。
	 *  3. 点击时按下微缩（active:scale），给触摸/鼠标明确的触感回执。
	 *  4. 窄屏隐藏文字只留图标并收紧内边距，避免在顶栏挤占搜索按钮的位置。
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
		class="pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc(50%-0.125rem)] rounded-md bg-background shadow-sm ring-1 ring-border/60 transition-transform duration-[220ms] ease-[cubic-bezier(.22,.61,.36,1)] motion-reduce:transition-none"
		style="transform: translateX({index === 1 ? '100%' : '0%'})"
		aria-hidden="true"
	></span>

	{#each options as opt, i (opt.id)}
		<a
			href={opt.href}
			aria-current={index === i ? "page" : undefined}
			class={cn(
				"relative z-10 flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md text-xs font-medium",
				"transition-[color,transform] duration-200 ease-out active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100",
				index === i ? "text-foreground" : "text-muted-foreground hover:text-foreground"
			)}
		>
			<!-- 图标随选中微放大：比单纯变色更快被眼睛捕捉到 -->
			<opt.icon class="size-3.5 shrink-0 transition-transform duration-200 ease-out {index === i ? 'scale-110' : 'scale-100'} motion-reduce:transition-none" />
			<!-- 窄屏只留图标：后台顶栏在手机上要同时容纳搜索、主题、查看前台等入口 -->
			<span class="hidden truncate sm:inline">{opt.label}</span>
		</a>
	{/each}
</nav>
