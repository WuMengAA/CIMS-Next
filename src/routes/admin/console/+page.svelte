<script lang="ts">
	import { onMount } from "svelte";
	import { invalidateAll } from "$app/navigation";
	import { Button } from "$lib/components/ui/button/index.js";
	import { ROLE_LABELS, type Role } from "$lib/permissions.js";
	import {
		MonitorSmartphone,
		Megaphone,
		Inbox,
		ScrollText,
		UsersRound,
		Send,
		SlidersHorizontal,
		AppWindow,
		MonitorCog,
		ScreenShare,
		RefreshCw,
		Loader2,
		WifiOff,
		AlertTriangle,
		Lock,
		ArrowRight,
		Eye,
		Bell,
		Dices,
		Volume2,
		MonitorDot,
		CalendarClock,
		Music,
		CalendarDays,
		ArrowLeftRight,
		Smartphone,
		Wrench
	} from "@lucide/svelte";
	import type { PageData } from "./$types";

	// 集控「概览」真页（A4.2，2026-10-02）。
	// 旧版这页只是一个铺满内容区的嵌入壳（承载 static/console/index.html）。现在改为
	// 站点同栈的真页面，只放三块最常用的内容：设备在线、控制轴计数、快捷入口。
	// 其余尚未迁移的功能（课表/定时任务/切班/音量/远控/点歌/随机点名/大屏壳…）仍从
	// （旧版面板入口已于 2026-10-02 摘除：27 个视图全部有真页。）
	let { data }: { data: PageData } = $props();

	const roleLabel = $derived(ROLE_LABELS[data.role as Role] || data.role);

	// ── 设备在线（经 /api/console/cims 服务端代理读 CIMS）──────────────────
	type Async = "loading" | "ok" | "error";
	let devState = $state<Async>("loading");
	let devError = $state("");
	let devTotal = $state(0);
	let devOnline = $state(0);
	let devFresh = $state(90);
	// 代理会按角色收敛设备范围：无「可读设备」档位时直接返回 {devices: [], fresh_seconds}
	// （**不含 count**），这与「真的 0 台设备」（响应带 count）形状不同。单独标出来，
	// 避免把「权限上不可见」当成「全校没设备」静默显示成 0 —— 诚实 UI 红线。
	let devScopedEmpty = $state(false);

	async function loadDevices() {
		devState = "loading";
		devError = "";
		devScopedEmpty = false;
		try {
			const r = await fetch("/api/console/cims/class/device-status");
			if (!r.ok) throw new Error("HTTP " + r.status);
			const j = (await r.json()) as {
				count?: number;
				online_count?: number;
				fresh_seconds?: number;
				devices?: { online?: boolean }[];
			};
			const hasList = Array.isArray(j?.devices);
			const list: { online?: boolean }[] = hasList ? (j?.devices ?? []) : [];
			// 台数一律以**过滤后的 devices[]** 为准，而不是响应里的 count / online_count：
			// 代理层按班级/权限范围收敛时只改写 devices[]（见 api/console/cims/[...cims] 的
			// applyScopeFilter），count 仍是全校口径 —— 直接用 count 会让概览与「设备控制」
			// 页对同一个班级账号报出两个不同的台数，也会把全校台数展示给班级级账号。
			devTotal = hasList ? list.length : Number(j?.count ?? 0) || 0;
			devOnline = hasList
				? list.filter((d) => d?.online).length
				: Number(j?.online_count ?? 0) || 0;
			devFresh = Number(j?.fresh_seconds ?? 90) || 90;
			// 响应没有 count 字段且列表为空 = 代理因权限返回空范围（与「真 0 台」形状不同）。
			devScopedEmpty = typeof j?.count !== "number" && list.length === 0;
			devState = "ok";
		} catch (e) {
			devState = "error";
			devError = (e as Error)?.message || "拉取失败";
		}
	}

	// ── 控制轴计数（本站协作库，不经 CIMS）────────────────────────────────
	let sumState = $state<Async>("loading");
	let sumError = $state("");
	let sum = $state<{
		notices: number;
		chatMessages: number;
		auditEntries: number;
		lastAuditAt: string | null;
	} | null>(null);

	async function loadSummary() {
		sumState = "loading";
		sumError = "";
		try {
			const r = await fetch("/api/console/control/summary");
			if (!r.ok) throw new Error("HTTP " + r.status);
			sum = await r.json();
			sumState = "ok";
		} catch (e) {
			sumState = "error";
			sumError = (e as Error)?.message || "拉取失败";
		}
	}

	// 设备重试：先重跑服务端 load（重新体检 cims.configured / reachable），再重拉。
	async function retryDevices() {
		devState = "loading";
		devError = "";
		await invalidateAll();
		if (!data.cims.reachable) {
			devState = "error";
			devError = "CIMS 不可达";
			return;
		}
		await loadDevices();
	}

	onMount(() => {
		if (data.cims.reachable) loadDevices();
		else {
			devState = "error";
			devError = "CIMS 不可达";
		}
		loadSummary();
	});

	// 服务端体检：凭据已配但连不上（或未配）。两种情况给出的排查方向不同，文案分开。
	const cimsDown = $derived(!data.cims.reachable);

	// ── 快捷入口（按真实页面门槛决定「可用」还是「禁用」）───────────────────
	// 口径：**能看就放行**。这些子页的服务端页面门槛几乎都只是 viewConsole（能进本页
	// 的人已满足），页内写操作由各自服务端二次收敛。因此只有三类入口需要额外门控：
	//   ① notify ← broadcast（sendBroadcast ‖ control，服务端发送时强制）
	//   ② logs   ← logsView（细档 logs_view，读日志时才 403）
	//   ③ apps   ← appsView（细档 apps_view，读软件列表时才 403）
	// 其余入口（devices/receipts/classes/monitor/manage/messages）不再门控 —— 按旧的
	// 「写能力」档位去禁用会比服务端更严，把老师/电教委员能只读打开的页也挡掉了。
	// 不够的项**禁用而非静默隐藏**：用户能知道功能存在、需要什么权限，而不是看到一屏空白。
	// 禁用的是不可点的 div，所以不会出现「点了被服务端 403」的错配（本项目反复强调的口径）。
	type Quick = {
		title: string;
		desc: string;
		href: string;
		icon: typeof MonitorSmartphone;
		need: boolean;
		needLabel: string;
		group: string; // 2026-10-04 项目化：设备 / 通知 / 教学 / 系统
	};

	// 快捷入口分组（星集控项目壳内部导航）：
	const QUICK_GROUPS = ["设备", "通知", "教学", "系统"] as const;

	const quick = $derived.by(() => {
		const list: Quick[] = [
			{
				title: "设备控制",
				desc: "截图 · 锁屏 · 关机 · 远控 · 调音量",
				href: "/admin/console/devices",
				icon: MonitorSmartphone,
				need: true,
				needLabel: "",
				group: "设备"
			},
			{
				// 2026-10-04：管理端入口收敛后必须保留 mobile 入口，否则手机集控页变孤儿。
				title: "手机集控",
				desc: "云端 WS+JPEG 截图 · 全动作移动控制台",
				href: "/admin/console/mobile",
				icon: Smartphone,
				need: true,
				needLabel: "",
				group: "设备"
			},
			{
				title: "发布通知",
				desc: "向班级 / 年级 / 全校广播",
				href: "/admin/console/notify",
				icon: Megaphone,
				need: data.can.broadcast,
				needLabel: "广播权限",
				group: "通知"
			},
			{
				title: "执行回执",
				desc: "通知送达 / 已读 / 回复",
				href: "/admin/console/receipts",
				icon: Inbox,
				need: true,
				needLabel: "",
				group: "通知"
			},
			{
				title: "设备日志",
				desc: "教室机运行日志排障取证",
				href: "/admin/console/logs",
				icon: ScrollText,
				need: data.can.logsView,
				needLabel: "设备日志权限",
				group: "设备"
			},
			{
				title: "班级与审核",
				desc: "班级空间 · 待审队列",
				href: "/admin/console/classes",
				icon: UsersRound,
				need: true,
				needLabel: "",
				group: "系统"
			},
			{
				title: "消息中心",
				desc: "广播 / 通知 / 回执聚合",
				href: "/admin/console/messages",
				icon: Send,
				need: true,
				needLabel: "",
				group: "通知"
			},
			{
				title: "监控参数",
				desc: "监控与阈值设置",
				href: "/admin/console/monitor",
				icon: SlidersHorizontal,
				need: true,
				needLabel: "",
				group: "设备"
			},
			{
				title: "软件管理",
				desc: "查看 / 关闭教室机程序",
				href: "/admin/console/apps",
				icon: AppWindow,
				need: data.can.appsView,
				needLabel: "软件查看权限",
				group: "设备"
			},
			{
				title: "设备管理",
				desc: "设备列表 / 软件 / 日志聚合",
				href: "/admin/console/manage",
				icon: MonitorCog,
				need: true,
				needLabel: "",
				group: "设备"
			},
			{
				// 2026-10-08 设备报修台账。真源在云端 repairs.json（cloud-ws a5266cf），
				// 不是站点本地存 —— 否则老师和被控端报的同一件事会出现两套账。
				// 生产副本可能还没同步 a5266cf，页内会显示「通道未启用」而不是白屏。
				title: "设备报修",
				desc: "故障工单台账 · 建单 / 流转 / 备注",
				href: "/admin/console/repairs",
				icon: Wrench,
				need: true,
				needLabel: "",
				group: "设备"
			},
			{
				// 远程控制（A4.3 迁移）：唯一按设备档位门控的入口 —— 远控敏感，
				// 服务端页面门槛即 canDevice(role,"remote")，入口这里同步按 can.remote 禁用。
				title: "远程控制",
				desc: "WebRTC 接管教室桌面 · 键鼠下发",
				href: "/admin/console/remote",
				icon: ScreenShare,
				need: data.can.remote,
				needLabel: "远程控制权限",
				group: "设备"
			},
			// ── 2026-10-02 A4.3 第二批迁移（3 个新页）─────────────────────
			// 门控口径同其它入口：这三页的**真实页面门槛都是 viewConsole**
			// （random 无 server 文件；volume 的 server 只要求 viewConsole，
			//  其 control 档位由页内自行收敛"应用"按钮；classisland 纯只读）。
			// 所以入口一律不门控 —— 能进集控面板就能看，写操作在页内兜。
			{
				title: "随机点名",
				desc: "课堂随机抽取 · 名单保存在本机",
				href: "/admin/console/random",
				icon: Dices,
				need: true,
				needLabel: "",
				group: "教学"
			},
			{
				title: "音量调节",
				desc: "逐台/整班设定音量 · 一键静音",
				href: "/admin/console/volume",
				icon: Volume2,
				need: true,
				needLabel: "",
				group: "教学"
			},
			{
				title: "大屏壳状态",
				desc: "教室端模块 · 插件 · 运行态",
				href: "/admin/console/classisland",
				icon: MonitorDot,
				need: true,
				needLabel: "",
				group: "教学"
			},
			{
				title: "课表与调课",
				desc: "课表按班 · 作息全校共用 · 调课（换课）申请→审批→生效",
				href: "/admin/console/schedule",
				icon: CalendarDays,
				need: true,
				needLabel: "",
				group: "教学"
			},
			{
				title: "定时任务",
				desc: "每周 / 一次性 / 倒计时计划",
				href: "/admin/console/scheduled",
				icon: CalendarClock,
				need: true,
				needLabel: "",
				group: "系统"
			},
			{
				title: "点歌台",
				desc: "校园广播点歌与待播队列",
				href: "/admin/console/voicehub",
				icon: Music,
				need: true,
				needLabel: "",
				group: "通知"
			},
			{
				title: "调课（换课）",
				desc: "课表内两节对调 · 申请→审批→自动生效",
				href: "/admin/console/schedule#swap",
				icon: ArrowLeftRight,
				need: true,
				needLabel: "",
				group: "教学"
			}
		];
		return list;
	});

	const canCount = $derived(quick.filter((q) => q.need).length);
	const offline = $derived(Math.max(0, devTotal - devOnline));
	const onlinePct = $derived(devTotal ? Math.round((devOnline / devTotal) * 100) : 0);
</script>

<svelte:head>
	<title>星集控 · 项目控制台 | Stelarith</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-6xl p-4 md:p-6">
	<!-- 项目壳页头（2026-10-04）：星集控作为独立项目，与站点 CMS 区分。
	     设备在线 / 控制轴计数保持下方区块，这里只呈现项目身份。 -->
	<div class="mb-5 flex items-center gap-3">
		<div class="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
			<MonitorSmartphone class="size-5" />
		</div>
		<div>
			<div class="flex items-center gap-2">
				<h1 class="font-heading text-lg font-semibold">星集控</h1>
				<span class="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">项目</span>
			</div>
			<p class="text-xs text-muted-foreground">
				教室设备集控项目：设备在线、控制轴计数与各功能入口。页面与账号体系归站点统一管理。
			</p>
		</div>
	</div>

	<!--
		只读说明条。
		⚠️ 现状提示（2026-10-02 实测）：`isConsoleReadOnly()` 是 `watch && !control`，
		而在当前的 `ROLE_DEVICE` 矩阵下 owner/admin/homeroom 都有 control、其余角色无 watch，
		因此该值为**恒 false** —— 这条目前不会出现。保留它是为将来补上"有 watch 无 control"的
		只读角色时自动生效；**不要**为了让它出现去改权限矩阵。
	-->
	{#if data.readonly}
		<div
			class="mb-4 flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
		>
			<Eye class="size-3.5 shrink-0" />
			<span>
				当前身份「{roleLabel}」为只读观看：下发、开关机、锁屏等写操作入口已禁用。需要操作权限请找站长调整身份。
			</span>
		</div>
	{/if}

	<!-- ① 设备在线 -->
	<section class="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div class="flex items-center gap-2.5">
				<span class="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
					<MonitorSmartphone class="size-5" />
				</span>
				<div>
					<h2 class="text-sm font-semibold">设备在线</h2>
					<p class="text-xs text-muted-foreground">数据取自教室机实时心跳。</p>
				</div>
			</div>
			<Button
				variant="outline"
				size="sm"
				onclick={retryDevices}
				disabled={devState === "loading" && !cimsDown}
			>
				<RefreshCw class="mr-1.5 size-3.5" /> 刷新
			</Button>
		</div>

		{#if devState === "loading" && !cimsDown}
			<div class="flex items-center justify-center py-8 text-sm text-muted-foreground">
				<Loader2 class="mr-2 size-4 animate-spin" /> 正在读取设备状态…
			</div>
		{:else if cimsDown || devState === "error"}
			<div class="mt-4 flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
				<WifiOff class="mt-0.5 size-4 shrink-0 text-destructive" />
				<div class="text-sm">
					<p class="font-medium text-destructive">CIMS 不可达，设备数据暂不可用</p>
					<p class="mt-1 text-xs text-muted-foreground">
						{#if !data.cims.configured}
							服务端尚未配置集控凭据（CIMS_ADMIN_EMAIL / CIMS_ADMIN_PASSWORD），读不到真实教室设备。
						{:else}
							凭据已配置，但连不上集控服务端。请确认服务在运行、地址可访问、账号密码有效。
						{/if}
						{#if devError}（{devError}）{/if}
					</p>
					<Button variant="outline" size="sm" class="mt-3" onclick={retryDevices}>
						<RefreshCw class="mr-1.5 size-3.5" /> 重试
					</Button>
				</div>
			</div>
		{:else if devScopedEmpty}
			<div class="mt-4 rounded-lg border border-border/60 bg-muted/40 p-4 text-sm text-muted-foreground">
				当前账号没有可查看的设备（代理按你的班级 / 权限范围返回了空列表）。这不代表全校没有设备 ——
				需要查看可联系站长调整范围。
			</div>
		{:else}
			<div class="mt-4 flex flex-wrap items-end gap-x-4 gap-y-1">
				<div class="flex items-baseline gap-2">
					<span
						class="font-heading text-3xl font-semibold tabular-nums {devTotal && devOnline === devTotal
							? 'text-emerald-600 dark:text-emerald-400'
							: ''}">{devOnline}</span
					>
					<span class="text-sm text-muted-foreground">在线 / 共 {devTotal} 台</span>
				</div>
				<div class="flex gap-2 text-xs text-muted-foreground">
					<span>离线 {offline} 台</span>
					<span aria-hidden="true">·</span>
					<span>超过 {devFresh} 秒无心跳判离线</span>
				</div>
			</div>
			<div class="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
				<div
					class="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
					style="width: {onlinePct}%"
				></div>
			</div>
			<a
				href="/admin/console/devices"
				class="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline"
			>
				查看设备详情 <ArrowRight class="size-3" />
			</a>
		{/if}
	</section>

	<!-- ② 控制轴计数 -->
	<section class="mt-5 rounded-xl border border-border/60 bg-card p-5 shadow-sm">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<div class="flex items-center gap-2.5">
				<span class="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
					<Bell class="size-5" />
				</span>
				<div>
					<h2 class="text-sm font-semibold">控制轴计数</h2>
					<p class="text-xs text-muted-foreground">本站协作库的累计数据（不依赖 CIMS）。</p>
				</div>
			</div>
			<Button variant="ghost" size="sm" onclick={loadSummary} disabled={sumState === "loading"}>
				{#if sumState === "loading"}
					<Loader2 class="mr-1.5 size-3.5 animate-spin" />
				{:else}
					<RefreshCw class="mr-1.5 size-3.5" />
				{/if}
				刷新
			</Button>
		</div>

		{#if sumState === "loading"}
			<div class="flex items-center justify-center py-6 text-sm text-muted-foreground">
				<Loader2 class="mr-2 size-4 animate-spin" /> 正在统计…
			</div>
		{:else if sumState === "error"}
			<div class="mt-4 flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
				<AlertTriangle class="mt-0.5 size-4 shrink-0 text-destructive" />
				<div class="text-sm">
					<p class="font-medium text-destructive">计数加载失败</p>
					<p class="mt-1 text-xs text-muted-foreground">{sumError}</p>
					<Button variant="outline" size="sm" class="mt-3" onclick={loadSummary}>
						<RefreshCw class="mr-1.5 size-3.5" /> 重试
					</Button>
				</div>
			</div>
		{:else if sum}
			<div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
				<div class="rounded-lg border border-border/60 bg-muted/30 p-3">
					<div class="font-heading text-2xl font-semibold tabular-nums">{sum.notices}</div>
					<div class="text-xs text-muted-foreground">通知</div>
				</div>
				<div class="rounded-lg border border-border/60 bg-muted/30 p-3">
					<div class="font-heading text-2xl font-semibold tabular-nums">{sum.chatMessages}</div>
					<div class="text-xs text-muted-foreground">交流消息</div>
				</div>
				<div class="rounded-lg border border-border/60 bg-muted/30 p-3">
					<div class="font-heading text-2xl font-semibold tabular-nums">{sum.auditEntries}</div>
					<div class="text-xs text-muted-foreground">审计记录</div>
				</div>
				<div class="rounded-lg border border-border/60 bg-muted/30 p-3">
					<div class="truncate text-sm font-medium" title={sum.lastAuditAt ?? "暂无"}>
						{sum.lastAuditAt || "暂无"}
					</div>
					<div class="text-xs text-muted-foreground">最近审计</div>
				</div>
			</div>
		{/if}
	</section>

	<!-- ③ 项目功能（2026-10-04 起按 设备/通知/教学/系统 分组，星集控项目内部导航） -->
	<section class="mt-5">
		<div class="mb-3 flex items-center justify-between gap-2">
			<h2 class="text-sm font-semibold">项目功能</h2>
			<span class="text-xs text-muted-foreground">{canCount} / {quick.length} 项当前身份可用</span>
		</div>
		{#each QUICK_GROUPS as gname (gname)}
			{@const items = quick.filter((q) => q.group === gname)}
			{#if items.length > 0}
				<h3 class="mb-2 mt-4 flex items-center gap-2 text-xs font-medium text-muted-foreground">
					{gname}
					<span class="h-px flex-1 bg-border/60" aria-hidden="true"></span>
					<span>{items.filter((q) => q.need).length}/{items.length}</span>
				</h3>
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{#each items as q (q.href)}
						{@const Icon = q.icon}
						{#if q.need}
							<a
								href={q.href}
								class="group flex items-start gap-3 rounded-xl border border-border/60 bg-card p-4 shadow-sm transition-colors hover:border-primary/40 hover:bg-muted/40"
							>
								<span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
									<Icon class="size-4" />
								</span>
								<span class="min-w-0">
									<span class="flex items-center gap-1 text-sm font-medium">
										{q.title}
										<ArrowRight class="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
									</span>
									<span class="mt-0.5 block truncate text-xs text-muted-foreground">{q.desc}</span>
								</span>
							</a>
						{:else}
							<div
								class="flex items-start gap-3 rounded-xl border border-dashed border-border/60 bg-muted/20 p-4 opacity-70"
								aria-disabled="true"
								title="需要{q.needLabel}"
							>
								<span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
									<Icon class="size-4" />
								</span>
								<span class="min-w-0">
									<span class="flex items-center gap-1 text-sm font-medium text-muted-foreground">
										{q.title}
										<Lock class="size-3.5" />
									</span>
									<span class="mt-0.5 block truncate text-xs text-muted-foreground">需要{q.needLabel}</span>
								</span>
							</div>
						{/if}
					{/each}
				</div>
			{/if}
		{/each}
	</section>

	<!--
		④ 旧版面板入口 —— **已于 2026-10-02 摘除**（用户批准）。
		缘由：旧面板 27 个视图已全部有 SvelteKit 真页（缺口表清零），这个"临时入口"完成使命。
		旧面板文件 `static/console/**` **仍在服务**（双轨期），直连 `/console/index.html` 仍可进，
		只是不再从界面导流。全部回收（删文件）属 A4.3 收尾，等一次生产版本周期后做。
	-->
</div>
