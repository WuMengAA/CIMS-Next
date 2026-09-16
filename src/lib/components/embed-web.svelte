<script lang="ts">
	import { ExternalLink, RefreshCw, MonitorSmartphone, TabletSmartphone, Smartphone, Maximize } from "@lucide/svelte";
	import { cn } from "$lib/utils";
	import { onMount } from "svelte";
	import { page } from "$app/state";

	let {
		src,
		title = "内嵌网页",
		height = 680,
		class: klass = ""
	}: {
		src: string;
		title?: string;
		height?: number;
		class?: string;
	} = $props();

	let w = $state("100%"); // iframe CSS 宽度：100% 或 Npx
	let wPx = $state(1280);
	let frameKey = $state(0);

	// 容器可用宽度：iframe 固定宽度模式不能超过它，否则侧边栏展开时内容被挤出视口。
	// 监听自身容器 + 侧边栏状态（Provider 会在折叠/折叠态变化时改变 Inset 宽度，
	// 容器 resize 随之触发，这里统一用 ResizeObserver 收敛）。
	let containerW = $state(0);
	let box: HTMLDivElement | undefined = $state(undefined);

	const presets = [
		{ label: "全宽", icon: Maximize, value: "100%" },
		{ label: "1280", icon: MonitorSmartphone, value: "1280px" },
		{ label: "768", icon: TabletSmartphone, value: "768px" },
		{ label: "375", icon: Smartphone, value: "375px" }
	];

	function setWidth(v: string) {
		w = v;
		if (v !== "100%") wPx = parseInt(v, 10);
	}

	// 实际用于 iframe 的宽度：固定 px 模式在容器变窄时自动回落为 100%，
	// 避免「侧边栏展开 → 内容区变窄 → 固定宽 iframe 溢出视口被裁剪」。
	const effectiveW = $derived.by(() => {
		if (w === "100%") return "100%";
		const px = parseInt(w, 10) || 0;
		return containerW > 0 && px > containerW ? "100%" : w;
	});

	onMount(() => {
		if (!box) return;
		const measure = () => {
			containerW = Math.max(0, box!.clientWidth || 0);
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(box!);
		// 依赖路径：SPA 导航（含前台/后台切换）后让测量在 DOM 更新后再跑一次
		const t = setTimeout(measure, 350);
		return () => {
			ro.disconnect();
			clearTimeout(t);
		};
	});

	// 侧边栏 toggle 时容器宽度过渡 300ms，ResizeObserver 会连续触发；
	// 这里额外订阅路径变化，确保「页面不刷新的侧边栏切换」后同样重测量。
	$effect(() => {
		page.url.pathname;
		if (box) queueMicrotask(() => { containerW = Math.max(0, box.clientWidth || 0); });
	});
</script>

<div class={cn("overflow-hidden rounded-xl border border-border bg-card", klass)}>
	<!-- 工具栏 -->
	<div class="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
		<div class="flex size-7 items-center justify-center rounded-md bg-primary/15 text-primary">
			<MonitorSmartphone class="size-4" />
		</div>
		<span class="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
		<div class="flex items-center gap-1">
			{#each presets as p (p.label)}
				<button
					type="button"
					title={p.label}
					class={cn(
						"flex size-7 items-center justify-center rounded-md transition-colors",
						effectiveW === p.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
					)}
					onclick={() => setWidth(p.value)}
				>
					<p.icon class="size-3.5" />
				</button>
			{/each}
		</div>
		<!-- 宽度微调滑块（仅 px 模式生效） -->
		<input
			type="range"
			min="320"
			max="1600"
			step="10"
			bind:value={wPx}
			class="hidden w-24 accent-primary md:block"
			oninput={() => (w = wPx + "px")}
			title="宽度调整"
		/>
		<button
			type="button"
			title="刷新"
			class="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent"
			onclick={() => (frameKey += 1)}
		>
			<RefreshCw class="size-4" />
		</button>
		<a
			href={src}
			target="_blank"
			rel="noopener noreferrer"
			title="新窗口打开"
			class="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent"
		>
			<ExternalLink class="size-4" />
		</a>
	</div>

	<!-- 内嵌区域：固定宽模式若超过容器自动回落 100%，绝不越界 -->
	<div bind:this={box} class="overflow-auto bg-muted/20 p-2 transition-[padding]">
		<iframe
			key={frameKey}
			src={src}
			title={title}
			loading="lazy"
			referrerpolicy="no-referrer"
			class="mx-auto block border-0 bg-white transition-[width] duration-200"
			style="width:{effectiveW};height:{height}px;"
		></iframe>
	</div>
</div>