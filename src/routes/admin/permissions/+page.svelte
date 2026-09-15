<script lang="ts">
	/**
	 * 权限总览：两条轴的完整可视化。
	 *
	 * 上半 —— 纵向「等级轴」：五级 × 功能矩阵，逐格打勾；当前账号所在列高亮。
	 * 下半 —— 横向「设备轴」：四档敏感度，与等级正交（电教委员内容 L2 但有 remote）。
	 *
	 * 所有数据来自 permissions.ts 的纯函数，本页不含任何硬编码权限判断。
	 */
	import { ShieldCheck, Check, Minus, MonitorSmartphone, Info, Crown } from "@lucide/svelte";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import {
		LEVEL_LABELS,
		LEVEL_DESCRIPTIONS,
		LEVEL_SAMPLE_ROLE,
		DEVICE_LABELS,
		DEVICE_DESCRIPTIONS,
		ACTION_LABELS,
		ROLE_LABELS,
		capabilitiesByLevel,
		hasAction,
		roleToLevel,
		roleDeviceTiers,
		type Level,
		type DeviceTier,
		type Role
	} from "$lib/permissions.js";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	const LEVELS: Level[] = [1, 2, 3, 4, 5];
	const DEVICES: DeviceTier[] = ["watch", "control", "remote", "manage"];
	const matrix = capabilitiesByLevel();

	// 当前账号等级（用于高亮所在列）。未登录为 null。
	const myLevel = $derived(data.role ? roleToLevel(data.role) : null);
	const myRole = $derived((data.role ?? null) as Role | null);

	/** 某等级在某动作上是否具备权限 —— 用该等级的示例角色去问 can()。 */
	function levelHas(level: Level, action: string): boolean {
		return hasAction(LEVEL_SAMPLE_ROLE[level], action as any);
	}

	/** 当前账号是否持有某设备档位（高亮用）。 */
	function myDevice(tier: DeviceTier): boolean {
		return (data.deviceTiers as DeviceTier[]).includes(tier);
	}
</script>

<div class="mb-6">
	<h1 class="flex items-center gap-2 font-heading text-2xl font-semibold tracking-tight">
		<ShieldCheck class="size-6 text-primary" /> 权限总览
	</h1>
	<p class="mt-1 text-sm text-muted-foreground">
		两条互相独立的权限轴：纵向「等级」决定内容与治理能力，横向「设备」决定集控操作敏感度。
	</p>
</div>

<!-- ── 当前账号 ─────────────────────────────────────────────────────────── -->
<div class="mb-8 rounded-xl border border-border/60 bg-card p-5">
	<div class="flex flex-wrap items-center gap-3">
		<div class="flex items-center gap-2">
			<Crown class="size-4 text-primary" />
			<span class="font-heading font-medium">当前账号</span>
		</div>
		<Badge variant="default">{data.levelLabel}</Badge>
		{#if myRole}
			<span class="text-sm text-muted-foreground">
				角色 <span class="font-medium text-foreground">{ROLE_LABELS[myRole]}</span>
			</span>
		{/if}
		{#if data.readonlyConsole}
			<span class="rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
				集控面板：只读观看
			</span>
		{/if}
	</div>

	<!-- 该账号的设备档位条：直观看出「内容等级低但设备权限高」这类正交组合 -->
	<div class="mt-4 flex flex-wrap items-center gap-2">
		<span class="text-xs text-muted-foreground">设备权限：</span>
		{#each DEVICES as d (d)}
			<span
				class="rounded-md border px-2 py-0.5 text-xs font-medium {myDevice(d)
					? 'border-primary/40 bg-primary/10 text-primary'
					: 'border-border/60 bg-muted/30 text-muted-foreground/60'}"
			>
				{DEVICE_LABELS[d]}
			</span>
		{/each}
	</div>
</div>

<!-- ── 纵向：等级 × 功能矩阵 ─────────────────────────────────────────────── -->
<section class="mb-10">
	<h2 class="mb-1 font-heading text-lg font-semibold">纵向 · 等级轴（五等）</h2>
	<p class="mb-4 text-sm text-muted-foreground">
		等级越高包含越低等级的全部能力。「功能限制」即由此矩阵逐格体现。
	</p>

	<div class="overflow-x-auto rounded-xl border border-border/60">
		<table class="w-full min-w-[46rem] text-sm">
			<thead>
				<tr class="border-b border-border/60 bg-muted/30">
					<th class="px-4 py-3 text-left font-medium">功能</th>
					{#each LEVELS as lv (lv)}
						<th
							class="px-3 py-3 text-center font-medium {myLevel === lv ? 'bg-primary/10 text-primary' : ''}"
						>
							<div class="flex flex-col items-center gap-0.5">
								<span>{LEVEL_LABELS[lv]}</span>
								{#if myLevel === lv}
									<span class="text-[10px] font-normal">当前</span>
								{/if}
							</div>
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each matrix as row, i (row.level)}
					<!-- 等级分隔行：把"这一档新增了什么"讲清楚 -->
					<tr class="border-b border-border/40 bg-muted/15">
						<td colspan={6} class="px-4 py-2">
							<div class="flex flex-wrap items-baseline gap-2">
								<span class="font-heading text-xs font-semibold">{LEVEL_LABELS[row.level]}</span>
								<span class="text-xs text-muted-foreground">{LEVEL_DESCRIPTIONS[row.level]}</span>
							</div>
						</td>
					</tr>
					{#if row.actions.length === 0}
						<tr class="border-b border-border/30 last:border-0">
							<td class="px-4 py-2.5 text-muted-foreground">（基础档，无专属功能）</td>
							{#each LEVELS as lv (lv)}
								<td class="px-3 py-2.5 text-center {myLevel === lv ? 'bg-primary/5' : ''}">
									<span class="text-muted-foreground/40">—</span>
								</td>
							{/each}
						</tr>
					{:else}
						{#each row.actions as action (action)}
							<tr class="border-b border-border/30 last:border-0">
								<td class="px-4 py-2.5">{ACTION_LABELS[action]}</td>
								{#each LEVELS as lv (lv)}
									<td class="px-3 py-2.5 text-center {myLevel === lv ? 'bg-primary/5' : ''}">
										{#if levelHas(lv, action)}
											<Check class="mx-auto size-4 text-success" strokeWidth={2.5} />
										{:else}
											<Minus class="mx-auto size-4 text-muted-foreground/35" />
										{/if}
									</td>
								{/each}
							</tr>
						{/each}
					{/if}
				{/each}
			</tbody>
		</table>
	</div>

	<p class="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
		<Info class="mt-0.5 size-3.5 shrink-0" />
		<span>
			等级是「包含式」的：L4 自动拥有 L1–L3 的全部能力，因此表中低等级列为勾选的功能，高等级列必然也是勾选。
		</span>
	</p>
</section>

<!-- ── 横向：设备权限轴 ──────────────────────────────────────────────────── -->
<section>
	<h2 class="mb-1 flex items-center gap-2 font-heading text-lg font-semibold">
		<MonitorSmartphone class="size-5 text-primary" /> 横向 · 设备轴（四档）
	</h2>
	<p class="mb-4 text-sm text-muted-foreground">
		与等级完全独立。等级高不代表能远控设备，等级低也不代表不能 —— 例如电教委员内容等级为 L2，却持有远程控制权限。
	</p>

	<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
		{#each DEVICES as d, i (d)}
			<div
				class="rounded-xl border p-4 {myDevice(d) ? 'border-primary/40 bg-primary/[0.04]' : 'border-border/60 bg-card'}"
			>
				<div class="mb-2 flex items-center justify-between">
					<span class="font-heading text-sm font-semibold">第 {i + 1} 档 · {DEVICE_LABELS[d]}</span>
					{#if myDevice(d)}
						<Badge variant="outline" class="text-[10px]">已具备</Badge>
					{/if}
				</div>
				<p class="text-xs leading-relaxed text-muted-foreground">{DEVICE_DESCRIPTIONS[d]}</p>
			</div>
		{/each}
	</div>

	<div class="mt-4 rounded-xl border border-border/60 bg-muted/20 p-4">
		<p class="text-xs leading-relaxed text-muted-foreground">
			<span class="font-medium text-foreground">包含关系：</span>
			持有较高档位即自动涵盖较低档位（远程控制天然包含锁屏/重启）。因此集控面板里
			「控制 / 远程 / 管理」三个开关不是并列关系，而是逐级递增的能力。
		</p>
	</div>
</section>
