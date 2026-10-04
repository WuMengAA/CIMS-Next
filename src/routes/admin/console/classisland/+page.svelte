<script lang="ts">
	import { onMount } from "svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "$lib/components/ui/card/index.js";
	import { Loader2, RefreshCw, ArrowLeft, AlertTriangle, Boxes, Plug, Server, Activity, WifiOff } from "@lucide/svelte";

	// ClassIsland 教室端 · 运行状态（只读真页）
	// ── 2026-10-02 从旧原生面板 static/console/app.js 的 views.classisland 迁移。
	//
	// 这一页只回答一个问题：**这台教室机现在装了什么、在跑什么**。
	// 数据取自设备真实心跳（经同源代理 /api/console/control/device-status），
	// 展示模块开关、宿主已加载插件（星集控插件单独标出）与插件上报的补充遥测。
	//
	// ⚠️ 纯只读，硬约束：旧面板里的「快捷功能入口 / 模块开关 / 切班」等**全部写操作都不搬**
	//    到本页 —— 那些留在「设备控制」页与旧版面板。本页没有任何下发按钮。

	type Plugin = {
		name?: string;
		id?: string;
		version?: string;
		status?: string;
		enabled?: boolean;
		error?: string;
		isStelarith?: boolean;
		is_stelarith?: boolean;
	};

	type DevRaw = {
		client_id?: string;
		host?: string;
		online?: boolean;
		reported?: boolean;
		age_seconds?: number;
		reported_at?: string;
		ip?: string;
		version?: string;
		class_id?: string;
		class_name?: string;
		active_class_group?: string;
		modules?: Record<string, boolean>;
		plugins?: Plugin[];
		extra?: Record<string, unknown>;
	};

	type Dev = {
		id: string;
		host: string;
		hostKnown: boolean;
		online: boolean;
		reported: boolean;
		last: string;
		reportedAt: string;
		ip: string;
		ver: string;
		classId: string;
		className: string;
		activeGroup: string;
		modules: Record<string, boolean>;
		plugins: Plugin[];
		extra: Record<string, unknown>;
		stateLabel: string;
		stateKind: "ok" | "err" | "warn";
	};

	// 星璃模块目录：与 static/console/api.js 的 MODULE_CATALOG 同源（同一份 id/label/desc）。
	// 这里只做只读展示，不带 enabled 开关交互 —— 旧面板那一列按钮是写操作，刻意不迁。
	// 设备上报了目录之外的模块也照原样列出（不隐藏），label 加「（未登记）」。
	const MODULE_CATALOG: { id: string; label: string; core: boolean; desc: string }[] = [
		{ id: "heartbeat", label: "状态心跳上报", core: true, desc: "定期上报在线状态、插件清单与模块开关。关闭后面板将看不到这台设备。" },
		{ id: "command_poll", label: "集控指令通道", core: true, desc: "轮询并执行集控下发的指令（锁屏/截图/切班/广播）。关闭后本机将失去远程控制能力。" },
		{ id: "sync", label: "资源主动同步", core: false, desc: "定时从集控拉取课表 / 作息 / 科目 / 组件配置。" },
		{ id: "writeback", label: "写回 ClassIsland 档案", core: false, desc: "把同步到的资源写入本机档案，使大屏真正显示新配置。" },
		{ id: "notification", label: "集控播报", core: false, desc: "把集控广播落到 ClassIsland 官方提醒系统，在大屏播放遮罩播报。" },
		{ id: "os_actions", label: "本机动作（锁屏 / 截图）", core: false, desc: "允许集控对这台机器执行锁屏与截屏。" },
		{ id: "remote_control", label: "远程控制转发", core: false, desc: "允许集控经本地代理发起远程控制（VNC）会话。" },
		{ id: "class_switch", label: "远程切班", core: false, desc: "允许集控把本班大屏切到指定课表群。考试/重要活动期间可临时关闭。" },
		{ id: "camera_capture", label: "摄像头抓拍与录像", core: false, desc: "允许集控抓取本机摄像头画面（抓拍/短录像）。关闭后摄像头类指令一律拒绝。" },
		{ id: "media_p2p", label: "P2P 媒体直连", core: false, desc: "允许本机作为点对点端点被直连观看（高带宽画面走设备之间，不经服务器）。" },
		{ id: "message_feed", label: "岛内消息中心", core: false, desc: "在 ClassIsland 设置页 / 托盘里查看本机最近的广播与通知。" }
	];

	let devices = $state<Dev[]>([]);
	let loading = $state(true);
	let error = $state("");
	let fresh = $state(90);
	let currentId = $state("");

	/** 秒 → 人话（与「设备控制」页同口径，粒度到秒/分/时/天）。 */
	function ago(sec: number | null | undefined): string {
		if (typeof sec !== "number" || !isFinite(sec)) return "从未上报";
		if (sec < 60) return sec + " 秒前";
		if (sec < 3600) return Math.floor(sec / 60) + " 分钟前";
		if (sec < 86400) return Math.floor(sec / 3600) + " 小时前";
		return Math.floor(sec / 86400) + " 天前";
	}

	function norm(d: DevRaw): Dev {
		const online = !!d.online;
		const reported = !!d.reported;
		return {
			id: String(d.client_id ?? ""),
			host: String(d.host ?? ""),
			hostKnown: !!d.host,
			online,
			reported,
			last: reported ? ago(Number(d.age_seconds)) : "从未上报",
			reportedAt: String(d.reported_at ?? ""),
			ip: String(d.ip ?? ""),
			ver: String(d.version ?? "—"),
			classId: String(d.class_id ?? ""),
			className: String(d.class_name ?? ""),
			activeGroup: String(d.active_class_group ?? ""),
			modules: d.modules && typeof d.modules === "object" ? d.modules : {},
			plugins: Array.isArray(d.plugins) ? d.plugins : [],
			extra: d.extra && typeof d.extra === "object" ? (d.extra as Record<string, unknown>) : {},
			stateLabel: !reported ? "尚未接入" : online ? "在线" : "离线",
			stateKind: !reported ? "warn" : online ? "ok" : "err"
		};
	}

	async function load(silent = false) {
		if (!silent) loading = true;
		error = "";
		try {
			const r = await fetch("/api/console/control/device-status");
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			const j = (await r.json()) as { fresh_seconds?: number; devices?: DevRaw[] };
			fresh = Number(j?.fresh_seconds ?? 90) || 90;
			devices = Array.isArray(j?.devices) ? j.devices.map(norm) : [];
			// 记住当前选中；若原选中设备已消失（换账号/换范围），回落到第一台。
			if (!devices.some((d) => d.id === currentId)) currentId = devices[0]?.id ?? "";
		} catch (e) {
			error = (e as Error)?.message || "设备状态加载失败";
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		load();
	});

	const current = $derived(devices.find((d) => d.id === currentId) ?? devices[0] ?? null);

	const classLabel = $derived(
		current ? current.className || current.classId || "未绑定班级" : ""
	);

	// 模块列表（目录 + 未登记项），只读。
	const modules = $derived.by(() => {
		const cur = current;
		if (!cur) return [];
		const map = cur.modules || {};
		const known = MODULE_CATALOG.map((m) => ({ ...m, enabled: !!map[m.id] }));
		const extra = Object.keys(map)
			.filter((k) => !MODULE_CATALOG.some((m) => m.id === k))
			.map((k) => ({
				id: k,
				label: k + "（未登记）",
				core: false,
				desc: "插件上报了本页不认识的模块，照原样列出。",
				enabled: !!map[k]
			}));
		return known.concat(extra);
	});

	const stelarithPlugin = $derived(
		current?.plugins.find((p) => p.isStelarith || p.is_stelarith) ?? null
	);

	// extra 里的关键字段：认识的用中文标签 + 友好格式，不认识的照原样列出（有什么显示什么）。
	const EXTRA_LABELS: Record<string, string> = {
		pid: "进程 PID",
		version: "插件版本",
		plugin_version: "插件版本",
		os: "操作系统",
		os_name: "操作系统",
		os_version: "系统版本",
		platform: "运行平台",
		arch: "系统架构",
		hostname: "上报主机名",
		uptime_seconds: "运行时长",
		started_at: "启动时间",
		sync_ok: "资源同步",
		sync_at: "同步时间",
		sync_writeback: "档案写回",
		sync_error: "同步错误",
		last_error: "最近错误",
		cpu: "CPU",
		memory_mb: "内存占用"
	};
	function extraLabel(k: string): string {
		return EXTRA_LABELS[k] ?? k;
	}
	function fmtExtraVal(k: string, v: unknown): string {
		if (k === "uptime_seconds" && typeof v === "number" && isFinite(v)) {
			const h = Math.floor(v / 3600);
			const m = Math.floor((v % 3600) / 60);
			return `${h} 小时 ${m} 分`;
		}
		if (typeof v === "boolean") return v ? "是" : "否";
		if (v === null || v === undefined) return "—";
		if (typeof v === "object") return JSON.stringify(v);
		return String(v);
	}
	const extraEntries = $derived.by(() => Object.entries(current?.extra ?? {}));

	function stateClass(kind: "ok" | "err" | "warn"): string {
		return kind === "ok"
			? "bg-emerald-500/15 text-emerald-600"
			: kind === "err"
				? "bg-red-500/15 text-red-500"
				: "bg-amber-500/15 text-amber-600";
	}
</script>

<svelte:head>
	<title>ClassIsland 教室端 · 集控面板 | Stelarith</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-5xl p-4 md:p-6">
	<!-- 回概览 -->
	<a
		href="/admin/console"
		class="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-primary"
	>
		<ArrowLeft class="size-3.5" /> 回概览
	</a>

	<!-- 页头 -->
	<div class="mb-5 flex items-center gap-3">
		<div class="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
			<Server class="size-5" />
		</div>
		<div>
			<h1 class="font-heading text-lg font-semibold">ClassIsland 教室端</h1>
			<p class="text-xs text-muted-foreground">
				查看某台教室机现在装了什么、在跑什么 —— 模块、宿主插件与上报的补充遥测。本页只读，不下发任何指令。
			</p>
		</div>
	</div>

	{#if loading}
		<div class="flex items-center justify-center py-16 text-sm text-muted-foreground">
			<Loader2 class="mr-2 size-4 animate-spin" /> 正在读取设备运行状态…
		</div>
	{:else if error}
		<div class="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
			<AlertTriangle class="mt-0.5 size-4 shrink-0 text-destructive" />
			<div class="text-sm">
				<p class="font-medium text-destructive">设备状态加载失败</p>
				<p class="mt-1 text-xs text-muted-foreground">{error}</p>
				<Button variant="outline" size="sm" class="mt-3" onclick={() => load()}>
					<RefreshCw class="mr-1.5 size-3.5" /> 重试
				</Button>
			</div>
		</div>
	{:else if !devices.length}
		<div class="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
			<div class="flex items-start gap-3">
				<WifiOff class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
				<div class="text-sm">
					<p class="font-medium">该账户下暂无已注册设备</p>
					<p class="mt-1 text-xs text-muted-foreground">
						设备接入集控并上报心跳后，这里会显示它的真实运行状态（模块 / 插件 / 遥测）。
					</p>
				</div>
			</div>
		</div>
	{:else if current}
		<!-- 设备选择 + 刷新 -->
		<div class="mb-4 flex flex-wrap items-center gap-2">
			<span class="text-xs text-muted-foreground">选择设备</span>
			<select
				bind:value={currentId}
				class="h-9 min-w-[260px] max-w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
			>
				{#each devices as d (d.id)}
					<option value={d.id}>
						{d.hostKnown ? d.host : d.id + "（尚未上报主机名）"} · {d.className || d.classId || "未绑定"} · {d.stateLabel}
					</option>
				{/each}
			</select>
			<Button variant="outline" size="sm" onclick={() => load(true)}>
				<RefreshCw class="mr-1.5 size-3.5" /> 刷新状态
			</Button>
			<span class="text-xs text-muted-foreground">超过 {fresh} 秒无心跳判离线</span>
		</div>

		<!-- 离线 / 未接入 诚实提示 -->
		{#if !current.reported}
			<div class="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-500/5 p-3 text-xs">
				<WifiOff class="mt-0.5 size-3.5 shrink-0 text-amber-600" />
				<span class="text-muted-foreground">
					该设备<b>尚未接入集控</b>，从未上报过运行状态，因此下方模块 / 插件 / 遥测均为空。
				</span>
			</div>
		{:else if !current.online}
			<div class="mb-4 flex items-start gap-2 rounded-lg border border-border/60 bg-muted/40 p-3 text-xs">
				<WifiOff class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
				<span class="text-muted-foreground">
					该设备<b class="text-foreground">当前离线</b>，以下展示它<b>最后一次上报</b>的内容
					（最后上报于 {current.last}{current.reportedAt ? ` · ${current.reportedAt}` : ""}）。
				</span>
			</div>
		{/if}

		<!-- ① 基本信息 -->
		<Card>
			<CardHeader>
				<CardTitle class="flex items-center gap-2 text-sm">
					<Activity class="size-4" /> 设备状态
					<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs {stateClass(current.stateKind)}">
						{current.stateLabel}
					</span>
				</CardTitle>
				<CardDescription>
					数据取自该设备最近一次心跳（相对时间：{current.last}）。
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div class="grid gap-x-6 gap-y-3 sm:grid-cols-2">
					<div class="grid gap-y-2 text-sm">
						<div class="flex justify-between gap-3"><span class="text-muted-foreground">主机名</span><b class="truncate">{current.host || "—"}</b></div>
						<div class="flex justify-between gap-3"><span class="text-muted-foreground">设备 ID</span><b class="truncate font-mono text-xs">{current.id}</b></div>
						<div class="flex justify-between gap-3"><span class="text-muted-foreground">IP</span><b>{current.ip || "—"}</b></div>
						<div class="flex justify-between gap-3"><span class="text-muted-foreground">插件版本</span><b>{current.ver}</b></div>
					</div>
					<div class="grid gap-y-2 text-sm">
						<div class="flex justify-between gap-3"><span class="text-muted-foreground">所属班级</span><b>{classLabel}</b></div>
						<div class="flex justify-between gap-3"><span class="text-muted-foreground">最后心跳</span><b>{current.last}</b></div>
						<div class="flex justify-between gap-3"><span class="text-muted-foreground">当前课表群</span><b>{current.activeGroup || "—"}</b></div>
						<div class="flex justify-between gap-3"><span class="text-muted-foreground">星璃插件</span>
							<b>{stelarithPlugin ? (stelarithPlugin.version || "已加载") + (stelarithPlugin.status ? " · " + stelarithPlugin.status : "") : "未在心跳中报告"}</b>
						</div>
					</div>
				</div>
			</CardContent>
		</Card>

		<!-- ② 星璃功能模块 -->
		<Card class="mt-4">
			<CardHeader>
				<CardTitle class="flex items-center gap-2 text-sm"><Boxes class="size-4" /> 星璃功能模块</CardTitle>
				<CardDescription>
					这台设备上报的模块开关状态（只读）。带「核心」标记的模块关闭后设备将无法被集控发现或控制 —— 如需启停请到「设备控制」页操作。
				</CardDescription>
			</CardHeader>
			<CardContent>
				{#if modules.length}
					<div class="overflow-x-auto">
						<table class="w-full text-sm">
							<thead>
								<tr class="border-b text-left text-xs text-muted-foreground">
									<th class="py-2 pr-3 font-medium">模块</th>
									<th class="py-2 pr-3 font-medium">说明</th>
									<th class="py-2 font-medium">状态</th>
								</tr>
							</thead>
							<tbody>
								{#each modules as m (m.id)}
									<tr class="border-b last:border-0">
										<td class="py-2 pr-3">
											{m.label}
											{#if m.core}<span class="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">核心</span>{/if}
										</td>
										<td class="py-2 pr-3 text-xs text-muted-foreground">{m.desc || "—"}</td>
										<td class="py-2">
											<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs {m.enabled ? 'bg-emerald-500/15 text-emerald-600' : 'bg-muted text-muted-foreground'}">
												{m.enabled ? "已启用" : "已关闭"}
											</span>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">设备未上报模块开关（插件版本过旧或心跳失败）。</p>
				{/if}
			</CardContent>
		</Card>

		<!-- ③ 宿主插件清单 -->
		<Card class="mt-4">
			<CardHeader>
				<CardTitle class="flex items-center gap-2 text-sm"><Plug class="size-4" /> 宿主插件清单</CardTitle>
				<CardDescription>
					这台电脑上 ClassIsland 实际加载到的插件（由宿主的已加载插件列表反射采集）。插件装上即是加载状态，面板不能在这里启停它。
				</CardDescription>
			</CardHeader>
			<CardContent>
				{#if current.plugins.length}
					<div class="overflow-x-auto">
						<table class="w-full text-sm">
							<thead>
								<tr class="border-b text-left text-xs text-muted-foreground">
									<th class="py-2 pr-3 font-medium">插件</th>
									<th class="py-2 pr-3 font-medium">ID</th>
									<th class="py-2 pr-3 font-medium">版本</th>
									<th class="py-2 font-medium">加载状态</th>
								</tr>
							</thead>
							<tbody>
								{#each current.plugins as p, i (p.id || i)}
									<tr class="border-b last:border-0">
										<td class="py-2 pr-3">
											{p.name || p.id || "（未命名）"}
											{#if p.isStelarith || p.is_stelarith}
												<Badge class="ml-1" variant="secondary">星集控 · 核心</Badge>
											{/if}
										</td>
										<td class="py-2 pr-3 font-mono text-xs text-muted-foreground">{p.id || ""}</td>
										<td class="py-2 pr-3">{p.version || "—"}</td>
										<td class="py-2">
											<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs {p.enabled ? 'bg-emerald-500/15 text-emerald-600' : 'bg-muted text-muted-foreground'}">
												{p.status || (p.enabled ? "已加载" : "已禁用")}
											</span>
											{#if p.error}<div class="mt-1 text-xs text-amber-600">{p.error}</div>{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">设备未上报插件清单（插件版本过旧或心跳失败）。</p>
				{/if}
			</CardContent>
		</Card>

		<!-- ④ 补充遥测（extra） -->
		<Card class="mt-4">
			<CardHeader>
				<CardTitle class="flex items-center gap-2 text-sm"><Server class="size-4" /> 补充遥测（extra）</CardTitle>
				<CardDescription>插件在心跳里附加的字段，有什么显示什么（认识的中文标注，不认识的原样列出）。</CardDescription>
			</CardHeader>
			<CardContent>
				{#if extraEntries.length}
					<div class="grid gap-x-6 gap-y-2 sm:grid-cols-2">
						{#each extraEntries as [k, v] (k)}
							<div class="flex justify-between gap-3 border-b border-border/40 py-1.5 text-sm last:border-0">
								<span class="text-muted-foreground">{extraLabel(k)}</span>
								<b class="break-all text-right">{fmtExtraVal(k, v)}</b>
							</div>
						{/each}
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">设备未上报补充字段（插件版本过旧或心跳失败）。</p>
				{/if}
			</CardContent>
		</Card>
	{/if}
</div>
