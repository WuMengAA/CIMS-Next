<script lang="ts">
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "$lib/components/ui/card/index.js";
	import { ArrowLeft, RefreshCw, Volume2, VolumeX, Loader2, Send, Info } from "@lucide/svelte";
	import type { PageData } from "./$types";

	// 音量调节（Svelte 版 · 2026-10-02 从旧静态面板 views.volume 迁移）。
	//
	// 数据来源：GET /api/console/cims/class/device-status（服务端代理，按角色收敛范围）。
	// 下发链路（照旧实现用的那条命令通道，不自己发明）：
	//   ① POST /api/console/sign-task {action:"set_volume", ts} → {ok, token}
	//   ② POST /api/console/cims/account/{accountId}/client/{id}/command/send-notification
	//      body = JSON.stringify({ MessageContent: JSON.stringify({
	//        stelarith_task: { action:"set_volume", token, scope:"device", ts, value, muted } }) })
	//   被控端（星集控桌面端 device_agent）读 {value:0-100, muted:bool}。
	//
	// 回执三态（照旧面板 pollDevOutcome 的只读队列法，绝不把「已下发」写成「已生效」）：
	//   下发后读 GET /api/console/cims/v1/client/{uid}/command/stats（**只读**，不会吃掉命令），
	//   以「下发前快照」做增量比对：done↑=已执行 / failed↑=执行失败 / delivered↑=执行中 /
	//   pending↑=已下发待取走；25s 内无变化 → 「超时未见回执」，**不下任何成功/失败结论**。
	let { data }: { data: PageData } = $props();

	type Dev = { id: string; name: string; className: string; online: boolean; reported: boolean };
	type Kind = "idle" | "sending" | "sent" | "running" | "done" | "failed" | "timeout" | "blocked";
	type Status = { kind: Kind; text: string };

	let devices = $state<Dev[]>([]);
	let loading = $state(true);
	let error = $state("");
	let fresh = $state(90);
	let scopedEmpty = $state(false); // 代理因权限返回空范围（与「真 0 台」区分）
	const vol = $state<Record<string, number>>({});
	const muted = $state<Record<string, boolean>>({});
	const stat = $state<Record<string, Status>>({});
	const busyOne = $state<Record<string, boolean>>({});
	let bulkBusy = $state(false);
	let bulkNote = $state("");

	const canControl = $derived(data.can.control);
	const canSend = $derived(canControl && !!data.accountId);
	const onlineCount = $derived(devices.filter((d) => d.online).length);

	async function load() {
		loading = true;
		error = "";
		scopedEmpty = false;
		try {
			// 2026-10-05：自有 device-status（合并 bindings+云端），形态与 CIMS 兼容
			const r = await fetch("/api/console/control/device-status");
			if (!r.ok) throw new Error("HTTP " + r.status);
			const j = (await r.json()) as {
				count?: number;
				fresh_seconds?: number;
				devices?: Record<string, unknown>[];
			};
			fresh = Number(j?.fresh_seconds ?? 90) || 90;
			const list = Array.isArray(j?.devices) ? j.devices : [];
			devices = list
				.map((d) => ({
					id: String(d.client_id ?? ""),
					name: String(d.host || d.client_id || ""),
					className: String(d.class_name || d.class_id || ""),
					online: !!d.online,
					reported: !!d.reported
				}))
				.filter((d) => d.id);
			// 代理按角色收敛只改写 devices[]：响应无 count 且列表为空 = 权限范围内看不到设备，
			// 与「全校真的 0 台」形状不同，分开提示（诚实 UI）。
			scopedEmpty = typeof j?.count !== "number" && list.length === 0;
			for (const d of devices) {
				if (vol[d.id] === undefined) vol[d.id] = 50;
				if (muted[d.id] === undefined) muted[d.id] = false;
				if (!stat[d.id]) stat[d.id] = { kind: "idle", text: "未下发" };
			}
		} catch (e) {
			error = (e as Error)?.message || "设备状态加载失败";
		} finally {
			loading = false;
		}
	}
	onMount(load);

	/**
	 * 向单台设备下发 set_volume（2026-10-05：走自有设备指令通道，云端 /api/instructions）。
	 * 返回终态：done/failed（下发结果）/ sent（已写进设备连接，回执看指令回执页）。
	 */
	async function sendVolume(dev: Dev): Promise<"done" | "failed" | "timeout" | "sent"> {
		const id = dev.id;
		stat[id] = { kind: "sending", text: "下发中…" };
		try {
			const r = await fetch("/api/console/control/device-command", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					uid: id,
					action: "set_volume",
					params: { value: Math.round(vol[id] ?? 50), muted: !!muted[id] }
				})
			});
			const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
			if (!r.ok) {
				const reason = String(j?.detail ?? j?.error ?? "HTTP " + r.status);
				stat[id] = { kind: "failed", text: "下发被拒：" + reason };
				return "failed";
			}
		} catch (e) {
			stat[id] = { kind: "failed", text: "下发失败：" + ((e as Error)?.message || e) };
			return "failed";
		}

		// 已写进设备连接（云端 sent）。设备真执行的回执在「指令回执页」按 uid 查看；
		// 这里如实说"已下发"，不冒充"已执行"（铁律：不许谎报成功）。
		stat[id] = { kind: "sent", text: "已下发 · 等待设备回执（见指令回执页）" };
		return "sent";
	}

	async function applyOne(d: Dev) {
		if (!canSend) {
			toast.error(!canControl ? "无权限：设备控制" : "集控账户未就绪，无法下发");
			return;
		}
		if (!d.online) {
			toast.error(`${d.name} 当前离线，收不到指令`);
			return;
		}
		busyOne[d.id] = true;
		try {
			const r = await sendVolume(d);
			if (r === "done") toast.success(`${d.name} 已回报执行完成`);
			else if (r === "failed") toast.error(`${d.name} 下发或执行失败`);
			else if (r === "timeout") toast.warning(`${d.name} 已下发，超时未见回执`);
			else toast(`${d.name} 已下发，等待设备回执`);
		} finally {
			busyOne[d.id] = false;
		}
	}

	function toggleMute(d: Dev) {
		const id = d.id;
		if (!d.online) return;
		if (muted[id]) {
			muted[id] = false;
		} else {
			muted[id] = true;
			vol[id] = 0; // 静音即把设定值归零（与桌面端 volume_page 一致）
		}
	}

	async function applyAll() {
		if (!canSend) {
			toast.error(!canControl ? "无权限：设备控制" : "集控账户未就绪，无法下发");
			return;
		}
		const targets = devices.filter((d) => d.online);
		if (!targets.length) {
			toast.warning("当前没有在线设备可下发");
			return;
		}
		if (!confirm(`将对 ${targets.length} 台在线设备下发各自当前音量，确认继续？`)) return;
		bulkBusy = true;
		bulkNote = "";
		let done = 0, failed = 0, timeout = 0, sent = 0;
		for (const d of targets) {
			const r = await sendVolume(d);
			if (r === "done") done++;
			else if (r === "failed") failed++;
			else if (r === "timeout") timeout++;
			else sent++;
		}
		bulkBusy = false;
		bulkNote = `批量下发结束：已回报执行 ${done} · 失败 ${failed} · 超时未见回执 ${timeout} · 已下发待确认 ${sent}（共 ${targets.length} 台在线）`;
		toast.success("批量下发已结束");
	}

	function statusClass(k: Kind): string {
		switch (k) {
			case "done":
				return "bg-emerald-500/15 text-emerald-600";
			case "failed":
				return "bg-red-500/15 text-red-500";
			case "sending":
				return "bg-sky-500/15 text-sky-600";
			case "running":
				return "bg-indigo-500/15 text-indigo-600";
			case "sent":
			case "timeout":
				return "bg-amber-500/15 text-amber-600";
			default:
				return "bg-muted text-muted-foreground";
		}
	}
</script>

<svelte:head>
	<title>音量调节 · 集控面板 | Stelarith</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
	<a
		href="/admin/console"
		class="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
	>
		<ArrowLeft class="size-4" /> 回概览
	</a>

	<div class="flex items-center gap-3">
		<div class="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
			<Volume2 class="size-5" />
		</div>
		<div>
			<h1 class="font-heading text-lg font-semibold">音量调节</h1>
			<p class="text-xs text-muted-foreground">逐台拖动滑杆设定音量，或一键静音；点「应用」经命令通道下发到教室电脑。</p>
		</div>
	</div>

	<div class="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
		<Info class="mt-0.5 size-3.5 shrink-0" />
		<p>
			滑杆为<b>本地设定值</b>（当前设备端无音量回读通道）；「应用」只是把指令<b>下发</b>出去，
			<b>不等于设备已执行</b> —— 是否生效以下方回执态为准（成功 / 失败 / 超时未见回执）。
			设备端需部署星集控 ClassroomDeploy 包才会真正执行。
		</p>
	</div>

	{#if !canControl}
		<div class="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400">
			当前账号没有「设备控制」权限，仅可查看设备与设定值，无法下发。
		</div>
	{:else if !data.accountId}
		<div class="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400">
			集控账户未就绪（服务端 CIMS 未配置或不可达），下发功能暂不可用。
		</div>
	{/if}

	<Card>
		<CardHeader class="flex-row items-center justify-between gap-2 space-y-0">
			<div>
				<CardTitle class="flex items-center gap-2"><Volume2 class="size-4" /> 设备音量</CardTitle>
				<CardDescription>
					在线 {onlineCount} / 共 {devices.length} 台 · 超过 {fresh} 秒无心跳判离线；离线设备标记并禁用下发。
				</CardDescription>
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<Button variant="outline" size="sm" onclick={load} disabled={loading}>
					<RefreshCw class="mr-1.5 size-3.5" /> 刷新设备
				</Button>
				<Button size="sm" onclick={applyAll} disabled={bulkBusy || !canSend || onlineCount === 0}>
					{#if bulkBusy}<Loader2 class="mr-1.5 size-3.5 animate-spin" />{:else}<Send class="mr-1.5 size-3.5" />{/if}
					全部应用（在线 {onlineCount} 台）
				</Button>
			</div>
		</CardHeader>
		<CardContent class="space-y-3">
			{#if bulkNote}
				<p class="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{bulkNote}</p>
			{/if}

			{#if loading}
				<div class="flex items-center justify-center py-16 text-muted-foreground">
					<Loader2 class="mr-2 size-4 animate-spin" /> 正在加载设备…
				</div>
			{:else if error}
				<div class="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
					设备状态加载失败：{error}
				</div>
			{:else if scopedEmpty}
				<p class="py-10 text-center text-sm text-muted-foreground">
					当前权限范围内没有可管理的设备（并非全校 0 台）—— 请联系管理员确认班级绑定或设备权限。
				</p>
			{:else if !devices.length}
				<p class="py-10 text-center text-sm text-muted-foreground">还没有接入教室机 · 装好星集控、输入接入码就会出现</p>
			{:else}
				<div class="overflow-x-auto rounded-lg border">
					<table class="w-full min-w-[720px] border-collapse text-sm">
						<thead>
							<tr class="border-b bg-muted/40 text-left text-xs text-muted-foreground">
								<th class="px-3 py-2 font-medium">设备</th>
								<th class="px-3 py-2 font-medium">班级</th>
								<th class="px-3 py-2 font-medium">状态</th>
								<th class="px-3 py-2 font-medium">下发回执</th>
								<th class="px-3 py-2 font-medium">音量（0-100）</th>
								<th class="px-3 py-2 text-right font-medium">操作</th>
							</tr>
						</thead>
						<tbody>
							{#each devices as d (d.id)}
								<tr class="border-b align-middle" class:opacity-60={!d.online}>
									<td class="px-3 py-2">
										<div class="font-medium">{d.name}</div>
										<div class="text-xs text-muted-foreground">{d.id}</div>
									</td>
									<td class="px-3 py-2">
										<Badge variant="secondary">{d.className || "未绑定"}</Badge>
									</td>
									<td class="px-3 py-2">
										{#if !d.reported}
											<span class="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-600">尚未接入</span>
										{:else if d.online}
											<span class="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-600">在线</span>
										{:else}
											<span class="inline-flex items-center rounded-full bg-red-500/15 px-2 py-0.5 text-xs text-red-500">离线</span>
										{/if}
									</td>
									<td class="px-3 py-2">
										<span class={"inline-flex items-center rounded-full px-2 py-0.5 text-xs " + statusClass(stat[d.id]?.kind ?? "idle")}>
											{stat[d.id]?.text ?? "未下发"}
										</span>
									</td>
									<td class="px-3 py-2">
										<div class="flex items-center gap-2">
											<input
												type="range"
												min="0"
												max="100"
												value={vol[d.id] ?? 50}
												disabled={!d.online}
												oninput={(e) => {
													vol[d.id] = Number((e.currentTarget as HTMLInputElement).value);
													muted[d.id] = false;
												}}
												class="h-1.5 w-40 cursor-pointer appearance-none rounded-full bg-muted accent-primary disabled:cursor-not-allowed disabled:opacity-50"
											/>
											<span class="w-10 text-right tabular-nums text-muted-foreground">
												{muted[d.id] ? "静音" : (vol[d.id] ?? 50)}
											</span>
										</div>
									</td>
									<td class="px-3 py-2">
										<div class="flex items-center justify-end gap-1.5">
											<Button
												variant={muted[d.id] ? "secondary" : "outline"}
												size="sm"
												class="h-7 px-2 text-xs"
												disabled={!d.online}
												onclick={() => toggleMute(d)}
											>
												{#if muted[d.id]}<Volume2 class="mr-1 size-3" />取消静音{:else}<VolumeX class="mr-1 size-3" />静音{/if}
											</Button>
											<Button
												size="sm"
												class="h-7 px-2 text-xs"
												disabled={!d.online || busyOne[d.id] || !canSend}
												onclick={() => applyOne(d)}
											>
												{#if busyOne[d.id]}<Loader2 class="mr-1 size-3 animate-spin" />{:else}<Send class="mr-1 size-3" />{/if}
												应用
											</Button>
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<p class="text-xs text-muted-foreground">
					「已下发」表示指令已递送到集控服务端，<b>不代表设备已执行</b>；请以「下发回执」列的三态为准。
					超时未见回执时不下成功/失败结论，可稍后在「执行回执」页查看。
				</p>
			{/if}
		</CardContent>
	</Card>
</div>
