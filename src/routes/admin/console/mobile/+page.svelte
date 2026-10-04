<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { env } from "$env/dynamic/public";
	import { toast } from "svelte-sonner";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import {
		MonitorSmartphone,
		WifiOff,
		CircleCheck,
		Power,
		Lock,
		Send,
		Loader2,
		TriangleAlert,
		CircleDot,
		RefreshCw
	} from "@lucide/svelte";
	import type { PageData } from "./$types";

	// 手机集控（D6 · 2026-10-02）：复用站点账号（viewConsole 守卫见 +page.server.ts）。
	// 直连云端 /ws/viewer（WS＋JPEG 截图定案路径，不碰 WebRTC）。
	//
	// 数据流：浏览器 new WebSocket(PUBLIC_CLOUD_WS_URL) →
	//   收 viewer-ready / devices / subscribed / frame(base64 JPEG) / instruction-result
	//   发 subscribe(uid) / instruction(uid, action, params)
	// 关键纪律（与 D5 一致）：fail-silent —— 所有失败如实展示；不谎报"已执行"。
	const WS_URL = (env.PUBLIC_CLOUD_WS_URL || "ws://127.0.0.1:8788").trim();

	type Dev = {
		uid: string;
		version: string;
		online: boolean;
		framesIn: number;
		bytesIn: number;
		lastSeenAgoSec: number;
	};
	type StatusKind = "muted" | "ok" | "warn" | "err";
	type ResultRow = {
		id: string | null;
		action: string;
		state: string;
		result?: string;
		error?: string | null;
		data?: Record<string, any> | null;
		at: string;
	};
	type ProcItem = { pid: number; name: string; title?: string };
	type LogItem = { rows: string[]; path?: string; count?: number };
	type CamItem = string;
	type MediaItem = { name: string; path: string; size: number };
	type SchedItem = {
		id: string;
		what: string;
		at: number;
		atStr?: string;
		remainingSec?: number;
	};

	let ws = $state<WebSocket | null>(null);
	let connected = $state(false);
	let devices = $state<Dev[]>([]);
	let selectedUid = $state("");
	let frameUrl = $state("");
	let frameTs = $state("");
	let frameBytes = $state(0);
	let statusMsg = $state("未连接");
	let statusKind = $state<StatusKind>("muted");
	let results = $state<ResultRow[]>([]);
	let textToSend = $state("");
	let viewersCount = $state(0);

	// 批次1动作面板（对应管理端 QML 的 截图/音量/软件/日志/探活/启动程序）
	let volumeValue = $state(50);
	let volumeDlgOpen = $state(false);
	let volumeSending = $state(false);
	let launchTarget = $state("");
	let launchDlgOpen = $state(false);
	let procItems = $state<ProcItem[]>([]);
	let procTruncated = $state(false);
	let procCount = $state(0);
	let procDlgOpen = $state(false);
	let procLoading = $state(false);
	let logRows = $state<string[]>([]);
	let logPath = $state("");
	let logDlgOpen = $state(false);
	let pingBusy = $state(false);

	// 批次2动作面板（对应管理端 QML 21 按钮的 定时/摄像头/媒体/远控）
	let schedDlgOpen = $state(false);
	let schedItems = $state<SchedItem[]>([]);
	let schedLoading = $state(false);
	let schedDelayMin = $state(5);
	let camDlgOpen = $state(false);
	let camItems = $state<CamItem[]>([]);
	let camLoading = $state(false);
	let camDevice = $state("video0");
	let mediaDlgOpen = $state(false);
	let mediaItems = $state<MediaItem[]>([]);
	let mediaLoading = $state(false);
	let remoteBusy = $state(false);

	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let reconnectDelay = 1000;

	function setStatus(msg: string, kind: StatusKind = "muted") {
		statusMsg = msg;
		statusKind = kind;
	}

	// 2026-10-03：云端 /ws/viewer 已加鉴权，第一条消息必须是 auth。
	// 浏览器不能拿长期令牌（F12 就抄走了），所以每次连接前向本站服务端要一张短票（2 分钟有效）；
	// 重连时重新取一张，票过期也不会卡死。
	async function fetchTicket(): Promise<string> {
		const r = await fetch("/admin/console/mobile/ticket", { headers: { accept: "application/json" } });
		const j = await r.json().catch(() => null);
		if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
		return String(j.ticket || "");
	}

	async function connect() {
		if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
		setStatus("正在取云端票据…", "warn");
		let ticket = "";
		try {
			ticket = await fetchTicket();
		} catch (e) {
			setStatus("拿不到云端票据：" + ((e as Error)?.message || String(e)), "err");
			scheduleReconnect();
			return;
		}
		setStatus(`正在连接云端 ${WS_URL}…`, "warn");
		let sock: WebSocket;
		try {
			sock = new WebSocket(WS_URL);
		} catch (e) {
			setStatus("WebSocket 创建失败：" + ((e as Error)?.message || String(e)), "err");
			scheduleReconnect();
			return;
		}
		ws = sock;
		sock.binaryType = "arraybuffer"; // v1 画面帧是二进制；不设这个收到的是 Blob，解析不出 seq/uid
		sock.onopen = () => {
			connected = true;
			reconnectDelay = 1000;
			setStatus("已连上云端，正在鉴权…", "warn");
			sock.send(JSON.stringify(envelope("auth", { ticket })));
		};
		sock.onmessage = (ev) => {
			if (ev.data instanceof ArrayBuffer) {
				handleBinary(ev.data); // 画面帧
				return;
			}
			handleMessage(ev.data as string);
		};
		sock.onclose = () => {
			connected = false;
			if (frameUrl) URL.revokeObjectURL(frameUrl);
			frameUrl = "";
			setStatus("连接断开，重连中…", "warn");
			scheduleReconnect();
		};
		sock.onerror = () => {
			setStatus("连接出错（详见浏览器控制台）", "err");
		};
	}

	function scheduleReconnect() {
		if (reconnectTimer) return;
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			reconnectDelay = Math.min(reconnectDelay * 2, 15000);
			connect();
		}, reconnectDelay);
	}

	// 协议 v1 信封（《星集控-协议规范v1-2026-10-03.md》）：{v,type,id,ts,payload}
	// 文本消息一律走它；画面帧收到的是**二进制**（[1B 版本][2B 大端 headerLen][header JSON][JPEG]），
	// 所以 socket 必须设 binaryType="arraybuffer"，否则 Blob 解析不出 seq/uid → 画面永远黑。
	function envelope(type: string, payload: Record<string, unknown> = {}) {
		return { v: 1, type, id: "", ts: Date.now(), payload };
	}

	function send(type: string, payload: Record<string, unknown> = {}): boolean {
		if (!ws || ws.readyState !== WebSocket.OPEN) {
			toast.error("云端未连接，无法下发");
			return false;
		}
		ws.send(JSON.stringify(envelope(type, payload)));
		return true;
	}

	/** 解析 v1 二进制帧（含旧裸帧兜底），画到 <img> 上 */
	function handleBinary(buf: ArrayBuffer) {
		const u8 = new Uint8Array(buf);
		if (u8.length >= 4 && u8[0] === 1) {
			const hLen = (u8[1] << 8) | u8[2];
			if (hLen > 0 && hLen <= 4096 && u8.length >= 3 + hLen) {
				let header: Record<string, any> | null = null;
				try {
					header = JSON.parse(new TextDecoder().decode(u8.subarray(3, 3 + hLen)));
				} catch {
					return; // 帧头坏了就当这帧没来，不画半张图
				}
				if (!header || header.type !== "frame") return;
				const uid = String(header.uid ?? "");
				if (uid !== selectedUid) return; // 只画正在看的那台（口径与旧实现一致）
				if (frameUrl) URL.revokeObjectURL(frameUrl);
				const jpeg = buf.slice(3 + hLen);
				frameUrl = URL.createObjectURL(new Blob([jpeg], { type: header.mime || "image/jpeg" }));
				frameTs = header.ts ? new Date(Number(header.ts)).toISOString() : "";
				frameBytes = Number(header.bytes ?? jpeg.byteLength);
				return;
			}
		}
		// 兜底：旧裸帧（无头），整块即 JPEG
		if (frameUrl) URL.revokeObjectURL(frameUrl);
		frameUrl = URL.createObjectURL(new Blob([buf], { type: "image/jpeg" }));
		frameBytes = buf.byteLength;
	}

	function normDev(d: Record<string, unknown>): Dev {
		return {
			uid: String(d.uid ?? ""),
			version: String(d.version ?? ""),
			online: d.online !== false,
			framesIn: Number(d.framesIn ?? 0),
			bytesIn: Number(d.bytesIn ?? 0),
			lastSeenAgoSec: Number(d.lastSeenAgoSec ?? 0)
		};
	}

	function handleMessage(raw: string) {
		let msg: Record<string, any>;
		try {
			msg = JSON.parse(raw);
		} catch {
			return;
		}
		// v1 信封与旧扁平格式都认：有 v 字段就取 payload，否则整条就是旧结构
		const pay: Record<string, any> =
			msg && typeof msg === "object" && "v" in msg ? (msg.payload ?? {}) : msg;
		switch (msg.type) {
			case "authed":
			case "auth-ok":
				setStatus("已连上云端（已鉴权）", "ok");
				break;
			case "auth-fail":
				// 鉴权失败要说得清清楚楚，别让人以为是网络断了
				setStatus("云端拒绝鉴权：" + (pay.reason || "未提供原因"), "err");
				break;
			case "error":
				// v1 统一错误通道：云端拒绝必须看得见（fail-silent 红线）
				setStatus("云端拒绝：" + [pay.code, pay.message].filter(Boolean).join(" "), "err");
				break;
			case "viewer-ready":
				viewersCount = pay.viewers ?? 0;
				break;
			case "devices":
				devices = Array.isArray(pay.devices) ? pay.devices.map(normDev) : [];
				break;
			case "subscribed":
				if (pay.ok && pay.uid) {
					selectedUid = pay.uid;
					setStatus(`已订阅 ${pay.uid}${pay.auto ? "（自动）" : ""}`, "ok");
				}
				break;
			case "frame":
				// 兼容旧文本帧（base64）；v1 客户端走的是二进制帧（见 handleBinary）
				if (pay.uid === selectedUid && typeof pay.data === "string") {
					frameUrl = "data:image/jpeg;base64," + pay.data;
					frameTs = pay.ts || "";
					frameBytes = pay.bytes || 0;
				}
				break;
			case "instruction-result":
				pushResult(pay);
				break;
			default:
				break;
		}
	}

	function pushResult(msg: Record<string, any>) {
		const row: ResultRow = {
			id: msg.id ?? null,
			action: String(msg.action ?? ""),
			state: String(msg.state ?? ""),
			result: msg.result,
			error: msg.error ?? null,
			data: msg.data && typeof msg.data === "object" ? msg.data : null,
			at: msg.at || new Date().toISOString()
		};
		results = [row, ...results].slice(0, 20);
		// 批次1：process_list / log_tail 的附加数据直接进弹窗（软件/日志），其余动作只进回执列表
		if (row.state === "executed" && row.result === "done") {
			if (row.action === "process_list" && Array.isArray(row.data?.items)) {
				procItems = row.data.items as ProcItem[];
				procTruncated = Boolean(row.data.truncated);
				procCount = Number(row.data.count ?? procItems.length);
				procDlgOpen = true;
				toast.success(`「${row.action}」已返回 ${procItems.length} 个进程`);
				return;
			}
			if (row.action === "log_tail" && Array.isArray(row.data?.lines)) {
				logRows = (row.data.lines as string[]).slice(-60);
				logPath = String(row.data.path ?? "");
				logDlgOpen = true;
				return;
			}
			if (row.action === "list_shortcut_candidates" && Array.isArray(row.data?.items)) {
				// 与 process_list 可能同批返回；软件弹窗用 process_list，列表按顺序更新即可
				return;
			}
			// 批次2：摄像头/媒体/定时列表进各自弹窗
			if (row.action === "camera_list" && Array.isArray(row.data?.cameras)) {
				camItems = (row.data.cameras as CamItem[]).filter(Boolean);
				camLoading = false;
				return;
			}
			if (row.action === "media_list") {
				const raw = row.data?.files ?? row.data?.items ?? null;
				if (Array.isArray(raw)) {
					mediaItems = raw.map((f: any) =>
						typeof f === "string"
							? { name: String(f), path: String(f), size: 0 }
							: {
									name: String(f?.name ?? f?.path ?? "?"),
									path: String(f?.path ?? f?.name ?? ""),
									size: Number(f?.size ?? 0)
								}
					);
					mediaLoading = false;
				}
				return;
			}
			if (row.action === "list_schedules") {
				const raw = row.data?.items ?? row.data?.schedules ?? null;
				if (Array.isArray(raw)) {
					schedItems = raw.map((s: any) => ({
						id: String(s?.id ?? ""),
						what: String(s?.what ?? s?.action ?? "?"),
						at: Number(s?.at ?? 0),
						atStr: s?.atStr ?? (s?.at ? new Date(Number(s.at)).toLocaleString() : ""),
						remainingSec: Number(s?.remainingSec ?? 0)
					}));
					schedLoading = false;
					schedDlgOpen = true;
				}
				return;
			}
			toast.success(`「${row.action}」执行完成`);
		} else if (row.state === "executed") {
			toast.error(`「${row.action}」执行失败：${row.error || "未知原因"}`);
		} else if (row.state === "offline") {
			toast.error("设备离线，指令未下发");
		} else if (row.state === "bad-request") {
			toast.error("指令格式有误（缺 uid 或 action）");
		}
	}

	function selectDevice(uid: string) {
		if (!uid) return;
		selectedUid = uid;
		frameUrl = "";
		setStatus(`正在订阅 ${uid}…`, "warn");
		send("subscribe", { uid });
	}

	function sendAction(action: string, params: Record<string, unknown> = {}) {
		if (!selectedUid) {
			toast.error("请先选择一台设备");
			return;
		}
		if (!send("instruction", { uid: selectedUid, action, params })) return;
		setStatus(`已下发 ${action} → ${selectedUid}`, "ok");
	}

	function sendText() {
		const t = textToSend.trim();
		if (!t) return;
		sendAction("input", { type: "type", text: t });
		textToSend = "";
	}

	// ── 批次1动作（2026-10-03：补齐管理端已有、手机端缺失的入口）──────

	/** 探活：回执带 pong:true 与 RTT，走统一回执流，不额外弹窗 */
	function sendPing() {
		if (!selectedUid) return toast.error("请先选择一台设备");
		pingBusy = true;
		if (!send("instruction", { uid: selectedUid, action: "ping", params: {} })) {
			pingBusy = false;
			return;
		}
		setTimeout(() => {
			pingBusy = false;
		}, 1500);
	}

	function sendScreenshot() {
		sendAction("screenshot");
	}

	function openVolume() {
		if (!selectedUid) return toast.error("请先选择一台设备");
		volumeDlgOpen = true;
	}

	function sendVolume() {
		volumeSending = true;
		sendAction("set_volume", { value: volumeValue });
		setTimeout(() => (volumeSending = false), 1200);
	}

	function openLaunch() {
		if (!selectedUid) return toast.error("请先选择一台设备");
		launchDlgOpen = true;
	}

	function sendLaunch() {
		const t = launchTarget.trim();
		if (!t) return;
		sendAction("launch_app", { target: t });
		launchTarget = "";
		launchDlgOpen = false;
	}

	function openLog() {
		if (!selectedUid) return toast.error("请先选择一台设备");
		sendAction("log_tail", { lines: 60 });
	}

	function openSoftware() {
		if (!selectedUid) return toast.error("请先选择一台设备");
		procLoading = true;
		procDlgOpen = true;
		if (!send("instruction", { uid: selectedUid, action: "process_list", params: {} })) {
			procLoading = false;
		}
		setTimeout(() => (procLoading = false), 1500);
	}

	function stopProcess(item: ProcItem) {
		if (!item || !item.pid) return;
		if (!confirm(`确定结束进程 ${item.name}（pid ${item.pid}）？\n受保护的进程会被拒绝并写明原因。`)) return;
		sendAction("process_stop", { pid: item.pid });
	}

	// ── 批次2动作（2026-10-03：定时/摄像头/媒体/远控，对齐管理端 21 按钮）──────

	/** 打开定时弹窗并拉一次计划列表 */
	function openSched() {
		if (!selectedUid) return toast.error("请先选择一台设备");
		schedDlgOpen = true;
		schedLoading = true;
		if (!send("instruction", { uid: selectedUid, action: "list_schedules", params: {} })) {
			schedLoading = false;
		}
		setTimeout(() => (schedLoading = false), 1500);
	}

	function sendSchedule(what: "schedule_shutdown" | "schedule_reboot") {
		const min = Math.max(1, Math.floor(schedDelayMin));
		const delay_sec = min * 60;
		sendAction(what, { delay_sec });
		schedDlgOpen = false;
	}

	function cancelSchedule(item: SchedItem) {
		if (!item?.id) return;
		if (!confirm(`取消这条计划（${item.what}）？`)) return;
		sendAction("cancel_schedule", { id: item.id });
	}

	/** 打开摄像头弹窗并枚举设备 */
	function openCam() {
		if (!selectedUid) return toast.error("请先选择一台设备");
		camDlgOpen = true;
		camLoading = true;
		if (!send("instruction", { uid: selectedUid, action: "camera_list", params: {} })) {
			camLoading = false;
		}
		setTimeout(() => (camLoading = false), 2000);
	}

	function camSnapshot() {
		sendAction("camera_snapshot", { device: camDevice || "video0" });
	}

	function camRecordStart() {
		sendAction("camera_record_start", { device: camDevice || "video0", duration_sec: 120 });
	}

	function camRecordStop() {
		sendAction("camera_record_stop", {});
	}

	/** 打开媒体弹窗并列出媒体库 */
	function openMedia() {
		if (!selectedUid) return toast.error("请先选择一台设备");
		mediaDlgOpen = true;
		mediaLoading = true;
		if (!send("instruction", { uid: selectedUid, action: "media_list", params: {} })) {
			mediaLoading = false;
		}
		setTimeout(() => (mediaLoading = false), 2000);
	}

	function mediaPlay(item: MediaItem) {
		if (!item?.path) return;
		sendAction("media_session_start", { path: item.path });
	}

	function mediaStop() {
		sendAction("media_session_stop", {});
	}

	/** 远程控制开/关（管理端 remote_control_start {fps:20}） */
	function remoteControl(on: boolean) {
		if (!selectedUid) return toast.error("请先选择一台设备");
		remoteBusy = true;
		sendAction(on ? "remote_control_start" : "remote_control_stop", on ? { fps: 20 } : {});
		setTimeout(() => (remoteBusy = false), 1200);
	}

	/** 关闭所有批次1弹窗（供弹窗遮罩点击与 Escape 键调用）。 */
	function closeDlg() {
		volumeDlgOpen = false;
		launchDlgOpen = false;
		procDlgOpen = false;
		logDlgOpen = false;
		schedDlgOpen = false;
		camDlgOpen = false;
		mediaDlgOpen = false;
	}

	onMount(() => {
		void connect();
	});
	onDestroy(() => {
		if (reconnectTimer) clearTimeout(reconnectTimer);
		if (ws) {
			try {
				ws.close();
			} catch {
				/* 忽略 */
			}
		}
	});

	const statusClass = $derived(
		statusKind === "ok"
			? "text-emerald-600 dark:text-emerald-400"
			: statusKind === "warn"
				? "text-amber-600 dark:text-amber-400"
				: statusKind === "err"
					? "text-destructive"
					: "text-muted-foreground"
	);
	const selectedDev = $derived(devices.find((d) => d.uid === selectedUid) ?? null);
</script>

<svelte:head>
	<title>手机集控 · 星集控</title>
	<meta name="robots" content="noindex" />
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
</svelte:head>

<div class="mx-auto flex min-h-[100dvh] max-w-2xl flex-col gap-3 p-3 md:p-4">
	<!-- 顶部状态条 -->
	<div
		class="sticky top-0 z-10 -mx-3 -mt-3 flex items-center justify-between gap-2 border-b border-border/60 bg-background/90 px-3 py-2 backdrop-blur md:-mx-4 md:-mt-4 md:px-4"
	>
		<div class="flex items-center gap-2">
			<div class="flex size-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
				<MonitorSmartphone class="size-4" />
			</div>
			<div>
				<div class="text-sm font-semibold leading-tight">手机集控</div>
				<div class="text-[11px] text-muted-foreground">星集控 · 看画面 + 下发指令</div>
			</div>
		</div>
		<div class="flex items-center gap-1.5 text-xs {statusClass}" aria-live="polite">
			<span aria-hidden="true">●</span>
			<span class="font-medium">{statusMsg}</span>
		</div>
	</div>

	<!-- 设备选择 -->
	<div>
		<div class="mb-1.5 flex items-center justify-between">
			<span class="text-xs font-medium text-muted-foreground">选择设备（{devices.length}）</span>
			{#if connected}
				<button class="text-[11px] text-muted-foreground underline" onclick={() => send("devices")}>
					刷新
				</button>
			{/if}
		</div>
		{#if devices.length === 0}
			<div class="rounded-lg border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
				{connected ? "暂无在线设备（被控端未连接云端）" : "尚未连接云端"}
			</div>
		{:else}
			<div class="flex gap-2 overflow-x-auto pb-1">
				{#each devices as d (d.uid)}
					<button
						class="shrink-0 rounded-full border px-3 py-1.5 text-xs transition {selectedUid === d.uid
							? 'border-primary bg-primary/15 text-primary'
							: 'border-border/60 bg-card text-foreground'}"
						onclick={() => selectDevice(d.uid)}
					>
						{d.uid}
						{#if d.online}<span class="ml-1 text-emerald-500">●</span>{/if}
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<!-- 画面 -->
	<div
		class="relative flex min-h-[220px] items-center justify-center overflow-hidden rounded-xl border border-border/60 bg-black"
	>
		{#if frameUrl}
			<!-- svelte-ignore a11y_img_redundant_alt -->
			<img src={frameUrl} alt="教室画面" class="max-h-[60vh] w-full object-contain" />
			<div
				class="absolute right-2 top-2 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white/80"
			>
				{frameBytes ? (frameBytes / 1024).toFixed(0) + " KB" : ""} · {frameTs
					? new Date(frameTs).toLocaleTimeString()
					: ""}
			</div>
		{:else}
			<div class="flex flex-col items-center gap-1 text-center text-sm text-muted-foreground">
				{#if !connected}
					<WifiOff class="size-5" />
					<span>未连接云端</span>
				{:else if !selectedUid}
					<MonitorSmartphone class="size-5" />
					<span>在上方选择一台设备</span>
				{:else}
					<Loader2 class="size-5 animate-spin" />
					<span>等待画面…（已订阅 {selectedUid}）</span>
				{/if}
			</div>
		{/if}
	</div>

	<!-- 指令按钮 -->
	<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
		<Button
			size="lg"
			variant="outline"
			disabled={!selectedUid || !connected}
			onclick={() => sendAction("exec-test")}
		>
			<CircleDot class="mr-1 size-4" /> 测试
		</Button>
		<Button
			size="lg"
			variant="outline"
			disabled={!selectedUid || !connected}
			onclick={() => {
				if (confirm("确定锁屏？")) sendAction("lock");
			}}
		>
			<Lock class="mr-1 size-4" /> 锁屏
		</Button>
		<Button
			size="lg"
			variant="destructive"
			disabled={!selectedUid || !connected}
			onclick={() => {
				if (confirm("确定关机？该设备将关闭")) sendAction("shutdown");
			}}
		>
			<Power class="mr-1 size-4" /> 关机
		</Button>
		<Button
			size="lg"
			variant="destructive"
			disabled={!selectedUid || !connected}
			onclick={() => {
				if (confirm("确定重启？该设备将重启")) sendAction("reboot");
			}}
		>
			<RefreshCw class="mr-1 size-4" /> 重启
		</Button>
	</div>

	<!-- 批次1 · 常用动作（2026-10-03 补齐：截图/音量/软件/日志/探活/启动） -->
	<div class="grid grid-cols-3 gap-2">
		<Button
			size="sm"
			variant="outline"
			disabled={!selectedUid || !connected}
			onclick={sendPing}
		>
			{#if pingBusy}
				<Loader2 class="mr-1 size-3.5 animate-spin" />
			{:else}
				<RefreshCw class="mr-1 size-3.5" />
			{/if}
			探活
		</Button>
		<Button
			size="sm"
			variant="outline"
			disabled={!selectedUid || !connected}
			onclick={sendScreenshot}
		>
			截图
		</Button>
		<Button
			size="sm"
			variant="outline"
			disabled={!selectedUid || !connected}
			onclick={openVolume}
		>
			音量
		</Button>
		<Button
			size="sm"
			variant="outline"
			disabled={!selectedUid || !connected}
			onclick={openSoftware}
		>
			{#if procLoading}<Loader2 class="mr-1 size-3.5 animate-spin" />{/if}
			软件
		</Button>
		<Button
			size="sm"
			variant="outline"
			disabled={!selectedUid || !connected}
			onclick={openLog}
		>
			日志
		</Button>
		<Button
			size="sm"
			variant="outline"
			disabled={!selectedUid || !connected}
			onclick={openLaunch}
		>
			启动
		</Button>
	</div>

	<!-- 批次2 · 定时/摄像头/媒体/远控（2026-10-03 补齐，对齐管理端 21 按钮） -->
	<div class="grid grid-cols-3 gap-2">
		<Button
			size="sm"
			variant="outline"
			disabled={!selectedUid || !connected}
			onclick={openSched}
		>
			{#if schedLoading}<Loader2 class="mr-1 size-3.5 animate-spin" />{/if}
			定时
		</Button>
		<Button
			size="sm"
			variant="outline"
			disabled={!selectedUid || !connected}
			onclick={openCam}
		>
			{#if camLoading}<Loader2 class="mr-1 size-3.5 animate-spin" />{/if}
			摄像头
		</Button>
		<Button
			size="sm"
			variant="outline"
			disabled={!selectedUid || !connected}
			onclick={openMedia}
		>
			{#if mediaLoading}<Loader2 class="mr-1 size-3.5 animate-spin" />{/if}
			媒体
		</Button>
		<Button
			size="sm"
			variant="outline"
			disabled={!selectedUid || !connected || remoteBusy}
			onclick={() => remoteControl(true)}
		>
			{#if remoteBusy}<Loader2 class="mr-1 size-3.5 animate-spin" />{/if}
			远控开
		</Button>
		<Button
			size="sm"
			variant="outline"
			disabled={!selectedUid || !connected || remoteBusy}
			onclick={() => remoteControl(false)}
		>
			远控关
		</Button>
	</div>

	<!-- 发文字 -->
	<div class="flex gap-2">
		<input
			bind:value={textToSend}
			placeholder="输入要发送到被控端的文字…"
			class="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
			onkeydown={(e: KeyboardEvent) => {
				if (e.key === "Enter") sendText();
			}}
		/>
		<Button size="lg" disabled={!selectedUid || !connected || !textToSend.trim()} onclick={sendText}>
			<Send class="mr-1 size-4" /> 发送
		</Button>
	</div>

	<!-- 执行结果 -->
	<div>
		<div class="mb-1.5 text-xs font-medium text-muted-foreground">执行回执</div>
		{#if results.length === 0}
			<div class="rounded-lg border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
				暂无回执
			</div>
		{:else}
			<div class="space-y-1.5">
				{#each results as r (r.at + r.action + (r.id ?? ""))}
					<div
						class="flex items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2 text-xs"
					>
						{#if r.state === "executed" && r.result === "done"}
							<CircleCheck class="size-4 shrink-0 text-emerald-500" />
						{:else if r.state === "executed"}
							<TriangleAlert class="size-4 shrink-0 text-destructive" />
						{:else if r.state === "offline"}
							<WifiOff class="size-4 shrink-0 text-muted-foreground" />
						{:else}
							<RefreshCw class="size-4 shrink-0 text-amber-500" />
						{/if}
						<span class="font-medium">{r.action}</span>
						<span class="text-muted-foreground">
							{#if r.state === "executed"}
								{r.result === "done" ? "完成" : "失败" + (r.error ? "：" + r.error : "")}
							{:else if r.state === "sent"}已下发{:else if r.state === "offline"}设备离线{/if}
						</span>
						<span class="ml-auto text-[10px] text-muted-foreground">
							{new Date(r.at).toLocaleTimeString()}
						</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- 音量弹窗 -->
	{#if volumeDlgOpen}
		<div
			class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3"
			role="dialog"
			tabindex="-1"
			onkeydown={(e: KeyboardEvent) => {
				if (e.key === "Escape") closeDlg();
			}}
			aria-modal="true"
			onclick={(e: MouseEvent) => {
				if (e.target === e.currentTarget) volumeDlgOpen = false;
			}}
		>
			<div class="w-full max-w-md rounded-2xl border border-border bg-background p-4 shadow-xl">
				<div class="mb-3 flex items-center justify-between">
					<span class="text-sm font-semibold">音量</span>
					<button class="text-xs text-muted-foreground" onclick={() => (volumeDlgOpen = false)}>关闭</button>
				</div>
				<div class="mb-2 flex items-center justify-between">
					<span class="text-xs text-muted-foreground">设备 {selectedUid}</span>
					<span class="text-sm font-semibold tabular-nums">{volumeValue}%</span>
				</div>
				<input
					type="range"
					min="0"
					max="100"
					step="5"
					bind:value={volumeValue}
					class="w-full accent-primary"
				/>
				<Button
					class="mt-3 w-full"
					size="lg"
					disabled={!selectedUid || !connected || volumeSending}
					onclick={sendVolume}
				>
					{#if volumeSending}<Loader2 class="mr-1 size-4 animate-spin" />{/if}
					下发音量
				</Button>
				<p class="mt-2 text-[11px] text-muted-foreground">
					超范围会被被控端夹紧到 0–100，实际生效值见回执。
				</p>
			</div>
		</div>
	{/if}

	<!-- 启动程序弹窗 -->
	{#if launchDlgOpen}
		<div
			class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3"
			role="dialog"
			tabindex="-1"
			onkeydown={(e: KeyboardEvent) => {
				if (e.key === "Escape") closeDlg();
			}}
			aria-modal="true"
			aria-label="启动程序"
			onclick={(e: MouseEvent) => {
				if (e.target === e.currentTarget) launchDlgOpen = false;
			}}
		>
			<div class="w-full max-w-md rounded-2xl border border-border bg-background p-4 shadow-xl">
				<div class="mb-3 flex items-center justify-between">
					<span class="text-sm font-semibold">启动程序</span>
					<button class="text-xs text-muted-foreground" onclick={() => (launchDlgOpen = false)}>关闭</button>
				</div>
				<input
					bind:value={launchTarget}
					placeholder="程序名/路径，如 notepad"
					class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
					onkeydown={(e: KeyboardEvent) => {
						if (e.key === "Enter") sendLaunch();
					}}
				/>
				<Button
					class="mt-3 w-full"
					size="lg"
					disabled={!selectedUid || !connected || !launchTarget.trim()}
					onclick={sendLaunch}
				>
					<Send class="mr-1 size-4" /> 启动
				</Button>
				<p class="mt-2 text-[11px] text-muted-foreground">
					不在安全名单的程序会被被控端拒绝并写明原因。
				</p>
			</div>
		</div>
	{/if}

	<!-- 软件列表弹窗 -->
	{#if procDlgOpen}
		<div
			class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3"
			role="dialog"
			tabindex="-1"
			onkeydown={(e: KeyboardEvent) => {
				if (e.key === "Escape") closeDlg();
			}}
			aria-modal="true"
			aria-label="设备软件"
			onclick={(e: MouseEvent) => {
				if (e.target === e.currentTarget) procDlgOpen = false;
			}}
		>
			<div class="flex max-h-[80dvh] w-full max-w-md flex-col rounded-2xl border border-border bg-background p-4 shadow-xl">
				<div class="mb-3 flex items-center justify-between">
					<span class="text-sm font-semibold">正在运行的软件（{procCount}）</span>
					<button class="text-xs text-muted-foreground" onclick={() => (procDlgOpen = false)}>关闭</button>
				</div>
				{#if procLoading}
					<div class="py-8 text-center text-xs text-muted-foreground">正在读取…</div>
				{:else if procItems.length === 0}
					<div class="rounded-lg border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
						暂无返回。软件列表只列有窗口的进程，结束进程受三张硬禁止名单保护。
					</div>
				{:else}
					<div class="max-h-[55dvh] space-y-1 overflow-y-auto">
						{#each procItems as item (item.pid + item.name)}
							<div
								class="flex items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2 text-xs"
							>
								<span class="truncate font-medium">{item.name}</span>
								{#if item.title}<span class="truncate text-muted-foreground">{item.title}</span>{/if}
								<span class="shrink-0 text-[10px] text-muted-foreground">pid {item.pid}</span>
								<button
									class="ml-auto shrink-0 rounded-md border border-destructive/40 px-1.5 py-0.5 text-[11px] text-destructive"
									onclick={() => stopProcess(item)}
								>
									结束
								</button>
							</div>
						{/each}
					</div>
				{/if}
				{#if procTruncated}
					<p class="mt-2 text-[11px] text-muted-foreground">
						列表已截断（设备进程较多），前 {procCount} 条。
					</p>
				{/if}
			</div>
		</div>
	{/if}

	<!-- 日志弹窗 -->
	{#if logDlgOpen}
		<div
			class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3"
			role="dialog"
			tabindex="-1"
			onkeydown={(e: KeyboardEvent) => {
				if (e.key === "Escape") closeDlg();
			}}
			aria-modal="true"
			aria-label="设备日志"
			onclick={(e: MouseEvent) => {
				if (e.target === e.currentTarget) logDlgOpen = false;
			}}
		>
			<div class="flex max-h-[80dvh] w-full max-w-md flex-col rounded-2xl border border-border bg-background p-4 shadow-xl">
				<div class="mb-3 flex items-center justify-between">
					<span class="text-sm font-semibold">日志尾部</span>
					<button class="text-xs text-muted-foreground" onclick={() => (logDlgOpen = false)}>关闭</button>
				</div>
				{#if logRows.length === 0}
					<div class="rounded-lg border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
						暂无日志行返回。
					</div>
				{:else}
					<pre class="max-h-[55dvh] overflow-auto rounded-lg bg-black p-3 text-[10px] leading-relaxed text-white/90">{logRows.join("\n")}</pre>
					{#if logPath}
						<p class="mt-2 truncate text-[10px] text-muted-foreground">来源：{logPath}</p>
					{/if}
				{/if}
			</div>
		</div>
	{/if}

	<!-- 定时弹窗 -->
	{#if schedDlgOpen}
		<div
			class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3"
			role="dialog"
			tabindex="-1"
			onkeydown={(e: KeyboardEvent) => {
				if (e.key === "Escape") closeDlg();
			}}
			aria-modal="true"
			aria-label="定时关机重启"
			onclick={(e: MouseEvent) => {
				if (e.target === e.currentTarget) schedDlgOpen = false;
			}}
		>
			<div class="flex max-h-[80dvh] w-full max-w-md flex-col rounded-2xl border border-border bg-background p-4 shadow-xl">
				<div class="mb-3 flex items-center justify-between">
					<span class="text-sm font-semibold">定时关机 / 重启</span>
					<button class="text-xs text-muted-foreground" onclick={() => (schedDlgOpen = false)}>关闭</button>
				</div>
				<div class="mb-2 flex items-center gap-2">
					<span class="shrink-0 text-xs text-muted-foreground">延迟</span>
					<input
						type="number"
						min="1"
						max="720"
						bind:value={schedDelayMin}
						class="w-20 rounded-lg border border-input bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
					/>
					<span class="text-xs text-muted-foreground">分钟</span>
					<div class="ml-auto flex gap-2">
						<Button
							size="sm"
							variant="outline"
							disabled={!selectedUid || !connected}
							onclick={() => sendSchedule("schedule_shutdown")}
						>
							关机
						</Button>
						<Button
							size="sm"
							variant="outline"
							disabled={!selectedUid || !connected}
							onclick={() => sendSchedule("schedule_reboot")}
						>
							重启
						</Button>
					</div>
				</div>
				<p class="mb-2 text-[11px] text-muted-foreground">同一台机只保留一条待执行计划，新计划会顶掉旧的。</p>
				<div class="mb-1.5 text-xs font-medium text-muted-foreground">待执行计划</div>
				{#if schedLoading}
					<div class="py-6 text-center text-xs text-muted-foreground">正在读取…</div>
				{:else if schedItems.length === 0}
					<div class="rounded-lg border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
						当前没有待执行的定时计划。
					</div>
				{:else}
					<div class="max-h-[40dvh] space-y-1 overflow-y-auto">
						{#each schedItems as s (s.id + s.what + s.at)}
							<div
								class="flex items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2 text-xs"
							>
								<span class="font-medium">{s.what}</span>
								<span class="truncate text-muted-foreground">{s.atStr || new Date(s.at).toLocaleString()}</span>
								<button
									class="ml-auto shrink-0 rounded-md border border-destructive/40 px-1.5 py-0.5 text-[11px] text-destructive"
									onclick={() => cancelSchedule(s)}
								>
									取消
								</button>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<!-- 摄像头弹窗 -->
	{#if camDlgOpen}
		<div
			class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3"
			role="dialog"
			tabindex="-1"
			onkeydown={(e: KeyboardEvent) => {
				if (e.key === "Escape") closeDlg();
			}}
			aria-modal="true"
			aria-label="摄像头"
			onclick={(e: MouseEvent) => {
				if (e.target === e.currentTarget) camDlgOpen = false;
			}}
		>
			<div class="flex max-h-[80dvh] w-full max-w-md flex-col rounded-2xl border border-border bg-background p-4 shadow-xl">
				<div class="mb-3 flex items-center justify-between">
					<span class="text-sm font-semibold">摄像头</span>
					<button class="text-xs text-muted-foreground" onclick={() => (camDlgOpen = false)}>关闭</button>
				</div>
				<div class="mb-2">
					<span class="text-xs text-muted-foreground">设备</span>
					{#if camItems.length > 0}
						<select
							bind:value={camDevice}
							class="ml-2 rounded-lg border border-input bg-background px-2 py-1.5 text-xs outline-none"
						>
							{#each camItems as c (c)}
								<option value={c}>{c}</option>
							{/each}
						</select>
					{:else}
						<span class="ml-2 text-xs text-muted-foreground">
							{camLoading ? "正在枚举…" : "未枚举到设备（点下方「重新枚举」或检查 ffmpeg）"}
						</span>
					{/if}
				</div>
				<div class="grid grid-cols-2 gap-2">
					<Button
						size="sm"
						variant="outline"
						disabled={!selectedUid || !connected}
						onclick={camSnapshot}
					>
						拍一张
					</Button>
					<Button
						size="sm"
						variant="outline"
						disabled={!selectedUid || !connected}
						onclick={camRecordStart}
					>
						开始录像（120s）
					</Button>
					<Button
						size="sm"
						variant="destructive"
						disabled={!selectedUid || !connected}
						onclick={camRecordStop}
					>
						停止录像
					</Button>
					<Button
						size="sm"
						variant="outline"
						disabled={!selectedUid || !connected || camLoading}
						onclick={openCam}
					>
						{#if camLoading}<Loader2 class="mr-1 size-3.5 animate-spin" />{/if}
						重新枚举
					</Button>
				</div>
				<p class="mt-2 text-[11px] text-muted-foreground">
					拍照/录像走被控端 ffmpeg；失败会写明原因，不会报"成功其实没做"。
				</p>
			</div>
		</div>
	{/if}

	<!-- 媒体弹窗 -->
	{#if mediaDlgOpen}
		<div
			class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3"
			role="dialog"
			tabindex="-1"
			onkeydown={(e: KeyboardEvent) => {
				if (e.key === "Escape") closeDlg();
			}}
			aria-modal="true"
			aria-label="媒体库"
			onclick={(e: MouseEvent) => {
				if (e.target === e.currentTarget) mediaDlgOpen = false;
			}}
		>
			<div class="flex max-h-[80dvh] w-full max-w-md flex-col rounded-2xl border border-border bg-background p-4 shadow-xl">
				<div class="mb-3 flex items-center justify-between">
					<span class="text-sm font-semibold">媒体库（{mediaItems.length}）</span>
					<button class="text-xs text-muted-foreground" onclick={() => (mediaDlgOpen = false)}>关闭</button>
				</div>
				<div class="mb-2 flex gap-2">
					<Button
						size="sm"
						variant="outline"
						disabled={!selectedUid || !connected || mediaLoading}
						onclick={openMedia}
					>
						{#if mediaLoading}<Loader2 class="mr-1 size-3.5 animate-spin" />{/if}
						刷新列表
					</Button>
					<Button
						size="sm"
						variant="destructive"
						disabled={!selectedUid || !connected}
						onclick={mediaStop}
					>
						停止播放
					</Button>
				</div>
				{#if mediaLoading}
					<div class="py-6 text-center text-xs text-muted-foreground">正在读取…</div>
				{:else if mediaItems.length === 0}
					<div class="rounded-lg border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
						媒体库为空（可设被控端 STE_QT_MEDIA_DIR 指定目录）。
					</div>
				{:else}
					<div class="max-h-[50dvh] space-y-1 overflow-y-auto">
						{#each mediaItems as m (m.path + m.name)}
							<div
								class="flex items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2 text-xs"
							>
								<span class="truncate font-medium">{m.name}</span>
								{#if m.size}<span class="shrink-0 text-[10px] text-muted-foreground">{(m.size / 1048576).toFixed(1)}MB</span>{/if}
								<button
									class="ml-auto shrink-0 rounded-md border border-border/60 px-1.5 py-0.5 text-[11px]"
									onclick={() => mediaPlay(m)}
								>
									播放
								</button>
							</div>
						{/each}
					</div>
				{/if}
				<p class="mt-2 text-[11px] text-muted-foreground">
					点「播放」在教室机用 ffplay 播放；播放中再点其他文件会切换。
				</p>
			</div>
		</div>
	{/if}

	<p class="px-1 text-[11px] leading-relaxed text-muted-foreground">
		画面走云端 <code>/ws/viewer</code>（WS＋JPEG 截图定案路径，非 WebRTC）。锁屏/关机/重启属敏感操作，请在测试机 TEST1 上确认效果；正式教室机下发前请谨慎。
	</p>
</div>