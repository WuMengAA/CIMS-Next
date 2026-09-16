<script lang="ts">
	import { ICON_CATEGORIES, resolveIcon } from "$lib/icon-library";
	import { Button } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import { cn } from "$lib/utils";
	import { LayoutGrid } from "@lucide/svelte";

	let {
		value = "",
		onpick,
		triggerLabel = "选择图标",
		size = 18,
		class: klass = ""
	}: {
		value?: string;
		onpick?: (name: string) => void;
		triggerLabel?: string;
		size?: number;
		class?: string;
	} = $props();

	let open = $state(false);
	let query = $state("");
	let activeCat = $state("all");

	const CurrentIcon = $derived(resolveIcon(value));

	const categories = $derived(
		[{ id: "all", label: "全部", icons: ICON_CATEGORIES.flatMap((c) => c.icons) }, ...ICON_CATEGORIES]
	);

	const filtered = $derived(
		(query.trim()
			? ICON_CATEGORIES.flatMap((c) => c.icons).filter((i) => i.name.includes(query.trim().toLowerCase()))
			: activeCat === "all"
				? ICON_CATEGORIES.flatMap((c) => c.icons)
				: (categories.find((c) => c.id === activeCat)?.icons ?? []))
	);

	function pick(name: string) {
		onpick?.(name);
		open = false;
		query = "";
		activeCat = "all";
	}
</script>

<div class={cn("relative inline-block", klass)}>
	<Button
		type="button"
		variant="outline"
		size="sm"
		class="gap-2"
		onclick={() => (open = !open)}
	>
		{#if CurrentIcon}
			<CurrentIcon size={size} />
		{:else}
			<LayoutGrid size={size} />
		{/if}
		<span>{triggerLabel}</span>
	</Button>

	{#if open}
		<!-- 点击空白关闭 -->
		<button
			type="button"
			aria-label="关闭图标选择"
			class="fixed inset-0 z-40 cursor-default"
			onclick={() => (open = false)}
		></button>

		<div
			class="absolute z-50 mt-2 w-[320px] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-2xl"
		>
			<div class="mb-2 flex items-center gap-2">
				<Input
					placeholder="搜索图标名（如 home / music）"
					bind:value={query}
					class="h-8 text-sm"
				/>
				{#if CurrentIcon}
					<div class="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
						<CurrentIcon size={18} />
					</div>
				{/if}
			</div>

			<div class="mb-2 flex flex-wrap gap-1">
				{#each categories as cat (cat.id)}
					<button
						type="button"
						class={cn(
							"rounded-md px-2 py-1 text-xs transition-colors",
							(activeCat === cat.id && !query.trim()) || (query.trim() && cat.id === "all")
								? "bg-primary text-primary-foreground"
								: "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
						)}
						onclick={() => {
							activeCat = cat.id;
							query = "";
						}}
					>
						{cat.label}
					</button>
				{/each}
			</div>

			<div class="grid max-h-56 grid-cols-7 gap-1 overflow-y-auto pr-1">
				{#each filtered as icon (icon.name)}
					{@const Ic = icon.comp}
					<button
						type="button"
						title={icon.name}
						class={cn(
							"flex aspect-square items-center justify-center rounded-lg border transition-colors",
							value === icon.name
								? "border-primary bg-primary/10 text-primary"
								: "border-transparent hover:border-border hover:bg-accent"
						)}
						onclick={() => pick(icon.name)}
					>
						<Ic size={18} />
					</button>
				{/each}
				{#if filtered.length === 0}
					<p class="col-span-7 py-4 text-center text-xs text-muted-foreground">无匹配图标</p>
				{/if}
			</div>
		</div>
	{/if}
</div>
