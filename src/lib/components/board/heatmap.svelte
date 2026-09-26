<script lang="ts">
	/**
	 * 活跃度方块阵列（类 GitHub 贡献图）。
	 *
	 * 渲染策略：
	 * - 53 列 × 7 行，列为「周」（周日起），与 GitHub 一致；末尾对齐到今天。
	 * - 着色用 **`bg-primary` + 内联 opacity** 而不是拼 oklch 变量：主题色是 oklch 空间，
	 *   直接做字符串插值拼色在暗色主题下容易崩，opacity 则与色彩空间无关，永远安全。
	 * - 等级阈值**自适应**（按本图最大提交数分档），而不是 GitHub 写死的 1/3/6/10 ——
	 *   个人项目一年提交可能只有几十次，写死阈值会导致整张图几乎全灰。
	 * - tooltip 用原生 `title`：零依赖、可访问、移动端长按也能看。
	 */
	let {
		contrib = {},
		weeks = 53,
		label = "活跃度",
		sub = "",
		compact = false,
		mini = false
	}: {
		contrib?: Record<string, number>;
		weeks?: number;
		label?: string;
		sub?: string;
		compact?: boolean;
		/** mini：项目卡内嵌用 —— 去掉标题/图例/星期轴与月份轴，只留纯网格 */
		mini?: boolean;
	} = $props();

	const WEEKDAYS = ["", "一", "", "三", "", "五", ""];

	function dayKey(d: Date): string {
		const y = d.getFullYear();
		const m = String(d.getMonth() + 1).padStart(2, "0");
		const day = String(d.getDate()).padStart(2, "0");
		return `${y}-${m}-${day}`;
	}

	const grid = $derived.by(() => {
		const max = Math.max(1, ...Object.values(contrib ?? {}).map((n) => Number(n) || 0));
		// 自适应分档：≥1 就至少是 1 级，其余按比例分 1..4
		const levelOf = (count: number): number => {
			if (count <= 0) return 0;
			if (max <= 1) return 4;
			const l = Math.ceil((count / max) * 4);
			return Math.min(4, Math.max(1, l));
		};

		const today = new Date();
		today.setHours(0, 0, 0, 0);
		// 把末尾对齐到本周的最后一天（周六），这样最后一列是完整的一周
		const end = new Date(today);
		end.setDate(end.getDate() + (6 - end.getDay()));
		const start = new Date(end);
		start.setDate(start.getDate() - (weeks * 7 - 1));

		const cols: { key: string; month: string; cells: { date: string; count: number; level: number; future: boolean }[] }[] = [];
		let total = 0;
		let cursor = new Date(start);
		for (let w = 0; w < weeks; w++) {
			const cells: { date: string; count: number; level: number; future: boolean }[] = [];
			let month = "";
			for (let d = 0; d < 7; d++) {
				const key = dayKey(cursor);
				const count = Number(contrib?.[key] ?? 0) || 0;
				const future = cursor > today;
				// 月份标签取该列第一天（周日）所在的月
				if (d === 0) month = `${cursor.getMonth() + 1}月`;
				if (!future) total += count;
				cells.push({ date: key, count, level: levelOf(count), future });
				cursor.setDate(cursor.getDate() + 1);
			}
			cols.push({ key: `w${w}`, month, cells });
		}

		// 月份标签去重：只在「本月首次出现」的那一列显示，避免相邻列重复刷屏
		let lastMonth = "";
		const months = cols.map((c) => {
			if (c.month !== lastMonth) {
				lastMonth = c.month;
				return c.month;
			}
			return "";
		});

		return { cols, months, total, max };
	});

	const cellSize = $derived(compact ? "10px" : "12px");
</script>

<div class={mini ? "flex flex-col gap-1" : "rounded-xl border border-border/60 bg-card p-4"}>
	{#if !mini}
		<div class="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
			<h3 class="font-heading text-sm font-medium">{label}</h3>
			{#if sub}<span class="text-xs text-muted-foreground">{sub}</span>{/if}
			<span class="ml-auto text-xs text-muted-foreground">
				近一年 <strong class="text-foreground">{grid.total}</strong> 次提交
			</span>
		</div>
	{/if}

	<div class={mini ? "" : "overflow-x-auto pb-1"}>
		<div class="inline-flex min-w-full flex-col gap-1">
			{#if !mini}
				<!-- 月份轴 -->
				<div class="flex gap-[2px] pl-7">
					{#each grid.cols as col, i (col.key)}
						<span
							class="shrink-0 text-[10px] leading-none text-muted-foreground"
							style="width:{cellSize}"
						>{grid.months[i]}</span>
					{/each}
				</div>
			{/if}

			<div class="flex gap-[2px]">
				{#if !mini}
					<!-- 星期轴 -->
					<div class="flex w-7 shrink-0 flex-col gap-[2px] pr-1">
						{#each WEEKDAYS as w}
							<span
								class="flex items-center justify-end text-[10px] leading-none text-muted-foreground"
								style="height:{cellSize}"
							>{w}</span>
						{/each}
					</div>
				{/if}

				<!-- 数据列 -->
				{#each grid.cols as col (col.key)}
					<div class="flex shrink-0 flex-col gap-[2px]">
						{#each col.cells as cell (cell.date)}
							<div
								class="rounded-[2px] {cell.level === 0 ? 'bg-muted' : 'bg-primary'}"
								style="width:{cellSize};height:{cellSize};{cell.future ? 'opacity:0.25;' : cell.level === 0 ? '' : `opacity:${[0, 0.3, 0.5, 0.75, 1][cell.level]};`}"
								title={cell.future ? cell.date : `${cell.date} · ${cell.count} 次提交`}
							></div>
						{/each}
					</div>
				{/each}
			</div>
		</div>
	</div>

	{#if !mini}
		<div class="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground">
			<span>少</span>
			<div class="size-2.5 rounded-[2px] bg-muted"></div>
			{#each [0.3, 0.5, 0.75, 1] as o}
				<div class="size-2.5 rounded-[2px] bg-primary" style="opacity:{o}"></div>
			{/each}
			<span>多</span>
		</div>
	{/if}
</div>
