<script lang="ts">
	/**
	 * 进度与待办面板。
	 *
	 * 同一组件服务两个场景（前台只读 / 后台可编辑），靠 `editable` 切换 —— 避免
	 * 「展示版」和「编辑版」两份实现随需求漂移。
	 *
	 * 进度口径：已完成 / 总数。**没有待办时显示「未规划」而不是 0%**，
	 * 否则「还没录入计划」会被误读成「一点没做」。
	 */
	import { CheckCircle2, Circle, Flag, ListChecks } from "@lucide/svelte";

	export interface Todo {
		id: string;
		title: string;
		done: boolean;
		group: string;
		order: number;
	}
	export interface Milestone {
		id: string;
		title: string;
		due: string;
		state: "open" | "done";
	}

	let {
		todos = [],
		milestones = [],
		editable = false,
		onToggle
	}: {
		todos?: Todo[];
		milestones?: Milestone[];
		editable?: boolean;
		onToggle?: (id: string, done: boolean) => void;
	} = $props();

	const done = $derived(todos.filter((t) => t.done).length);
	const total = $derived(todos.length);
	const percent = $derived(total === 0 ? 0 : Math.round((done / total) * 100));

	/** 按 group 归拢，保持各分组内 order 升序；未分组排最后。 */
	const grouped = $derived.by(() => {
		const map = new Map<string, Todo[]>();
		for (const t of [...todos].sort((a, b) => a.order - b.order)) {
			const k = t.group || "";
			if (!map.has(k)) map.set(k, []);
			map.get(k)!.push(t);
		}
		return [...map.entries()].sort((a, b) => (a[0] === "" ? 1 : b[0] === "" ? -1 : 0));
	});
</script>

<div class="rounded-xl border border-border/60 bg-card p-4">
	<div class="mb-4 flex flex-wrap items-center gap-3">
		<ListChecks class="size-4 text-primary" />
		<h3 class="font-heading text-sm font-medium">进度与待办</h3>
		<span class="ml-auto text-xs text-muted-foreground">
			{#if total === 0}
				未规划
			{:else}
				{done} / {total} 项已完成
			{/if}
		</span>
	</div>

	<!-- 进度条 -->
	<div class="mb-5">
		<div class="mb-1.5 flex items-baseline justify-between text-xs">
			<span class="text-muted-foreground">整体进度</span>
			<span class="font-medium">{total === 0 ? "—" : `${percent}%`}</span>
		</div>
		<div class="h-2 w-full overflow-hidden rounded-full bg-muted">
			<div
				class="h-full rounded-full bg-primary transition-[width] duration-500"
				style="width:{percent}%"
			></div>
		</div>
	</div>

	{#if total === 0}
		<p class="rounded-lg border border-dashed border-border/60 px-4 py-6 text-center text-sm text-muted-foreground">
			还没有录入待办。{editable ? "在下方添加第一项。" : "项目方尚未公开计划。"}
		</p>
	{:else}
		<div class="flex flex-col gap-4">
			{#each grouped as [group, items] (group)}
				<div>
					{#if group}
						<p class="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{group}</p>
					{/if}
					<ul class="flex flex-col gap-1">
						{#each items as t (t.id)}
							<li class="flex items-start gap-2 rounded-md px-1 py-1 text-sm transition-colors hover:bg-muted/40">
								{#if editable}
									<button
										type="button"
										class="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-primary"
										aria-label={t.done ? "标记为未完成" : "标记为已完成"}
										onclick={() => onToggle?.(t.id, !t.done)}
									>
										{#if t.done}
											<CheckCircle2 class="size-4 text-primary" />
										{:else}
											<Circle class="size-4" />
										{/if}
									</button>
								{:else}
									<span class="mt-0.5 shrink-0">
										{#if t.done}<CheckCircle2 class="size-4 text-primary" />{:else}<Circle class="size-4 text-muted-foreground" />{/if}
									</span>
								{/if}
								<span class={t.done ? "text-muted-foreground line-through" : ""}>{t.title}</span>
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</div>
	{/if}

	{#if milestones.length > 0}
		<div class="mt-5 border-t border-border/40 pt-4">
			<div class="mb-2 flex items-center gap-2">
				<Flag class="size-3.5 text-primary" />
				<span class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">里程碑</span>
			</div>
			<ul class="flex flex-col gap-1.5">
				{#each milestones as m (m.id)}
					<li class="flex items-center gap-2 text-sm">
						<span
							class="size-1.5 shrink-0 rounded-full {m.state === 'done' ? 'bg-primary' : 'bg-muted-foreground/50'}"
						></span>
						<span class={m.state === "done" ? "text-muted-foreground line-through" : ""}>{m.title}</span>
						{#if m.due}<span class="ml-auto text-xs text-muted-foreground">{m.due}</span>{/if}
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</div>
