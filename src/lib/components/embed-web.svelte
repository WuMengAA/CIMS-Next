<script lang="ts">
	import { ExternalLink, RefreshCw, MonitorSmartphone, TabletSmartphone, Smartphone, Maximize } from "@lucide/svelte";
	import { cn } from "$lib/utils";

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
						w === p.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
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

	<!-- 内嵌区域 -->
	<div class="overflow-auto bg-muted/20 p-2 transition-[padding]">
		<iframe
			key={frameKey}
			src={src}
			title={title}
			loading="lazy"
			referrerpolicy="no-referrer"
			class="mx-auto block border-0 bg-white transition-[width] duration-200"
			style="width:{w};height:{height}px;"
		></iframe>
	</div>
</div>
