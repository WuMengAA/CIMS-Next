<script lang="ts">
	/**
	 * 权限总览：两套模型的完整可视化。
	 *
	 * 上半 —— 纵向「称号 × 功能」矩阵：每个称号授予哪些能力，逐格打勾；
	 *         当前账号持有的称号所在列高亮。
	 * 下半 —— 横向「设备轴」：四档敏感度，与称号正交（电教委员无内容强称号但持 remote）。
	 *
	 * ⚠️ #248：**权限矩阵上不再出现等级**——等级已改为经验值（xp→Lv，纯展示），
	 * 与权限零耦合。本页所有数据来自 permissions.ts 的纯函数，不含硬编码权限判断。
	 */
	import { ShieldCheck, Check, Minus, MonitorSmartphone, Info, Crown, Sparkles } from "@lucide/svelte";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import {
		TITLES,
		TITLE_KEYS,
		DEVICE_LABELS,
		DEVICE_DESCRIPTIONS,
		ACTION_LABELS,
		ROLE_LABELS,
		hasAction,
		roleDeviceTiers,
		type DeviceTier,
		type Role,
		type TitleKey,
		type Action
	} from "$lib/permissions.js";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	const DEVICES: DeviceTier[] = ["watch", "control", "remote", "manage"];
	// 全部功能（行）= 动作清单；列 = 称号目录。
	const ALL_ACTIONS: Action[] = Object.keys(ACTION_LABELS) as Action[];

	// 当前账号持有的称号（用于高亮列）。未登录为空。
	const myTitles = $derived((data.titles ?? []) as TitleKey[]);
	const myRole = $derived((data.role ?? null) as Role | null);

	/** 某称号是否授予某动作。 */
	function titleHas(title: TitleKey, action: Action): boolean {
		return TITLES[title].actions.includes(action);
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
		权限由<b class="text-foreground">称号</b>承载；经验等级（Lv）只是「参与度」展示，<b class="text-foreground">与权限完全无关</b>。
		某人能做什么，取决于他持有哪些称号；设备操作敏感度是与之正交的独立轴。
	</p>
</div>

<!-- ── 我的称号（权限的真实载体）────────────────────────────────────────── -->
<div class="mb-8 rounded-xl border border-primary/30 bg-primary/[0.04] p-5">
	<div class="flex flex-wrap items-center gap-3">
		<div class="flex items-center gap-2">
			<Crown class="size-4 text-primary" />
			<span class="font-heading font-medium">我的称号</span>
		</div>
		{#if data.titleLabels?.length}
			{#each data.titleLabels as t, i (t)}
				<Badge variant="default">{t}</Badge>
			{/each}
		{:else}
			<span class="text-sm text-muted-foreground">（无）</span>
		{/if}
	</div>
	<p class="mt-3 text-xs leading-relaxed text-muted-foreground">
		称号是权限的载体：每个称号授予一组能力（见下方矩阵）。管理员可为你<b class="text-foreground">独立追加或撤回</b>称号，
		与你的角色/经验等级无关——这是「权限分配」的最小可操作单元。
	</p>
	{#if data.titleDetails?.length}
		<ul class="mt-3 grid gap-2 sm:grid-cols-2">
			{#each data.titleDetails as td (td.key)}
				<li class="rounded-lg border border-border/60 bg-card px-3 py-2">
					<div class="text-sm font-medium">{td.label}</div>
					<div class="text-xs text-muted-foreground">{td.description}</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<!-- ── 当前账号 ─────────────────────────────────────────────────────────── -->
<div class="mb-8 rounded-xl border border-border/60 bg-card p-5">
	<div class="flex flex-wrap items-center gap-3">
		<div class="flex items-center gap-2">
			<Crown class="size-4 text-primary" />
			<span class="font-heading font-medium">当前账号</span>
		</div>
		<Badge variant="default">
			<Sparkles class="size-3 mr-1" />{data.levelLabel}
		</Badge>
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
	<p class="mt-3 text-xs leading-relaxed text-muted-foreground">
		经验等级（Lv）由经验值推导，<b class="text-foreground">只反映参与程度，不授予任何权限</b>——
		高等级的游客依然只是游客。
	</p>

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

<!-- ── 纵向：称号 × 功能矩阵（#248：矩阵不再按等级分轴，改按权限真实载体=称号）── -->
<section class="mb-10">
	<h2 class="mb-1 font-heading text-lg font-semibold">称号 × 功能矩阵</h2>
	<p class="mb-4 text-sm text-muted-foreground">
		每个<b class="text-foreground">称号</b>授予一组能力（打勾即授予）。你实际持有的称号集合（含管理员为你
		独立追加的）决定你的全部权限——<b class="text-foreground">与经验等级无关</b>。列头高亮 = 你当前持有的称号。
	</p>

	<div class="overflow-x-auto rounded-xl border border-border/60">
		<table class="w-full min-w-[46rem] text-sm">
			<thead>
				<tr class="border-b border-border/60 bg-muted/30">
					<th class="px-4 py-3 text-left font-medium">功能</th>
					{#each TITLE_KEYS as tk (tk)}
						<th
							class="px-3 py-3 text-center font-medium {myTitles.includes(tk) ? 'bg-primary/10 text-primary' : ''}"
						>
							<div class="flex flex-col items-center gap-0.5">
								<span>{TITLES[tk].label}</span>
								{#if myTitles.includes(tk)}
									<span class="text-[10px] font-normal">持有</span>
								{/if}
							</div>
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each ALL_ACTIONS as action (action)}
					<tr class="border-b border-border/30 last:border-0">
						<td class="px-4 py-2.5">{ACTION_LABELS[action]}</td>
						{#each TITLE_KEYS as tk (tk)}
							<td class="px-3 py-2.5 text-center {myTitles.includes(tk) ? 'bg-primary/5' : ''}">
								{#if titleHas(tk, action)}
									<Check class="mx-auto size-4 text-success" strokeWidth={2.5} />
								{:else}
									<Minus class="mx-auto size-4 text-muted-foreground/35" />
								{/if}
							</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<p class="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
		<Info class="mt-0.5 size-3.5 shrink-0" />
		<span>
			此矩阵展示每个称号<b class="text-foreground">静态授予</b>的能力；角色只是「称号预设」的组合，
			你实际持有的称号（含管理员独立追加/撤回）以「我的称号」一节为准。
		</span>
	</p>
</section>

<!-- ── 横向：设备权限轴 ──────────────────────────────────────────────────── -->
<section>
	<h2 class="mb-1 flex items-center gap-2 font-heading text-lg font-semibold">
		<MonitorSmartphone class="size-5 text-primary" /> 横向 · 设备轴（四档）
	</h2>
	<p class="mb-4 text-sm text-muted-foreground">
		与称号完全独立。有没有设备权限取决于角色预设与设备档位，与经验等级无关 ——
		例如电教委员无内容强称号（角色秩 3），却持有远程控制权限。
		电教委员本质是「注册用户全部内容能力 + 设备权限」<strong class="text-foreground">叠加</strong>，并非脱离用户的独立角色：
		它照样能评论、发帖、申请，只是额外持 remote 设备档位。
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
