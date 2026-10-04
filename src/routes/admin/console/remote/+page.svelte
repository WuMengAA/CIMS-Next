<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { toast } from "svelte-sonner";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "$lib/components/ui/card/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { StelarithP2P } from "$lib/console/p2p/connector";
	import {
		MonitorSmartphone,
		RefreshCw,
		Loader2,
		WifiOff,
		Play,
		Power,
		Keyboard,
		Maximize,
		ScreenShare,
		ShieldAlert,
		CircleCheck,
		TriangleAlert
	} from "@lucide/svelte";
	import type { PageData } from "./$types";

	// 远程控制（Svelte 版，2026-10-02 从原生面板 static/console/remote-webrtc.html 迁移 · B 路 WebRTC）。
	//
	// 数据流：GET /api/console/control/p2p-token?uid=<设备码>（用户会话 + remote 档）
	//   → new StelarithP2P(...) → connect()（进信令房间）→ startController(null)（发 offer）
	//   → 被控教室端回 answer + 桌面流 → on('track') 拿到远端画面。
	//
	// ⚠️ 本页铁律「演示不许报成功」：connect() 成功**只代表信令连上了**，不代表被控端已接受。
	// 因此在对端应答之前，状态一律是「等待对方响应…」（琥珀色），**绝不**出现绿色「已连接」；
	// 只有收到 on('startRemote')（对方已接受）后才允许出现「已接管」等字样。任何失败都展示可读原因。
	let { data }: { data: PageData } = $props();

	type Dev = { id: string; host: string; online: boolean; reported: boolean; className: string };
	type Phase = "idle" | "token" | "connecting" | "waiting" | "accepted" | "timeout" | "error";
	type StatusKind = "muted" | "ok" | "warn" | "err";

	let devices = $state<Dev[]>([]);
	let devLoading = $state(true);
	let devError = $state("");

	let phase = $state<Phase>("idle");
	let statusMsg = $state("未连接");
	let statusKind = $state<StatusKind>("muted");
	let selectedUid = $state("");
	let mediaLive = $state(false);
	let accepted = $state(false);
	let kbdCapture = $state(false);
	let quality = $state("balanced");

	let videoEl: HTMLVideoElement | undefined = $state();
	// $state.raw：p2p 是类实例，只需「引用变化时刷新 UI」，不应被深度代理（免得方法 this 被包坏）。
	let p2p = $state.raw<StelarithP2P | null>(null);
	let waitTimer: ReturnType<typeof setTimeout> | null = null;
	let kbdHandler: ((e: KeyboardEvent) => void) | null = null;

	// 「对方未响应」判定窗口：信令入房后 N 秒仍无 startRemote，即判未响应（不撒谎地给重试）。
	const WAIT_TIMEOUT_MS = 20_000;

	function setStatus(msg: string, kind: StatusKind = "muted") {
		statusMsg = msg;
		statusKind = kind;
	}

	function normDev(d: Record<string, unknown>): Dev {
		return {
			// 真实 CIMS device-status 的 id 字段是 client_id（旧 id 字段作为兜底兼容）。
			id: String(d.client_id ?? d.id ?? ""),
			host: String(d.host ?? ""),
			online: !!d.online,
			reported: !!d.reported,
			className: String(d.class_name ?? d.className ?? "")
		};
	}

	async function loadDevices() {
		devLoading = true;
		devError = "";
		try {
			const r = await fetch("/api/console/control/device-status", { credentials: "same-origin" });
			if (!r.ok) throw new Error("HTTP " + r.status);
			const j = (await r.json()) as { devices?: Record<string, unknown>[] };
			const list = Array.isArray(j?.devices) ? j.devices.map(normDev).filter((d) => d.id) : [];
			devices = list;
		} catch (e) {
			devError = (e as Error)?.message || "设备列表加载失败";
		} finally {
			devLoading = false;
		}
	}

	onMount(() => {
		loadDevices();
	});
	onDestroy(() => {
		teardown();
	});

	function clearWait() {
		if (waitTimer) {
			clearTimeout(waitTimer);
			waitTimer = null;
		}
	}

	// 只清理连接资源，不改状态文案（connect 开头复用）。
	function teardown() {
		clearWait();
		if (p2p) {
			try {
				p2p.close();
			} catch {
				/* 忽略 */
			}
			p2p = null;
		}
		if (videoEl) videoEl.srcObject = null;
		if (kbdHandler) {
			window.removeEventListener("keydown", kbdHandler, true);
			kbdHandler = null;
		}
		kbdCapture = false;
		accepted = false;
		mediaLive = false;
	}

	function disconnect() {
		teardown();
		selectedUid = "";
		phase = "idle";
		setStatus("已断开", "muted");
	}

	async function connect(uid: string) {
		if (!uid) return;
		if (phase === "token" || phase === "connecting") return;
		teardown(); // 断掉上一条会话（若有）

		selectedUid = uid;
		phase = "token";
		setStatus("正在获取信令令牌…", "warn");
		try {
			const r = await fetch(`/api/console/control/p2p-token?uid=${encodeURIComponent(uid)}`, {
				credentials: "same-origin"
			});
			if (!r.ok) {
				let reason = "HTTP " + r.status;
				try {
					const j = (await r.json()) as { error?: string };
					if (j?.error) reason = j.error;
				} catch {
					/* 响应非 JSON，保留 HTTP 码 */
				}
				if (r.status === 403) throw new Error(`无权限（${reason}）`);
				if (r.status === 401) throw new Error("登录已失效，请重新登录");
				throw new Error(`取令牌失败：${reason}`);
			}
			const cfg = (await r.json()) as {
				signalUrl?: string;
				roomId?: string;
				secret?: string;
				iceServers?: RTCIceServer[];
			};
			if (!cfg?.signalUrl || !cfg?.secret) throw new Error("信令配置不完整（缺少 signalUrl/secret）");

			phase = "connecting";
			setStatus("正在连接信令服务器…", "warn");

			const conn = new StelarithP2P({
				signalUrl: cfg.signalUrl,
				deviceUid: uid,
				secret: cfg.secret,
				roomId: cfg.roomId,
				rtcConfig: cfg.iceServers && cfg.iceServers.length ? { iceServers: cfg.iceServers } : undefined
			});

			// 远端桌面流到达：这是"确有画面"的实证，直接上屏；但**不**据此宣称"已接管"。
			conn.on("track", (stream) => {
				mediaLive = true;
				if (videoEl) {
					videoEl.srcObject = stream as MediaStream;
					void videoEl.play().catch(() => {
						/* 自动播放被拦截时用户可手动点播放 */
					});
				}
				if (accepted) setStatus("对方已接受，已接管", "ok");
				else setStatus("已收到远端画面（尚未收到对方接受回执）", "warn");
			});
			// 对方已接受 —— 这是唯一允许出现"已接管"字样的信号。
			conn.on("startRemote", () => {
				accepted = true;
				clearWait();
				phase = "accepted";
				setStatus("对方已接受，已接管", "ok");
			});

			await conn.connect();
			// 到这里只证明 **信令入房成功**，绝不等于对方接受。诚实文案如下。
			p2p = conn;
			phase = "waiting";
			setStatus("已进入信令房间，等待对方响应…（信令已连通 ≠ 对方已接受）", "warn");
			await conn.startController(null); // 仅接收教室桌面流，无需本机摄像头

			// 超时未获应答 → 明确判"未响应"并给重试，而不是一直转圈假装在连。
			clearWait();
			waitTimer = setTimeout(() => {
				if (!accepted) {
					phase = "timeout";
					setStatus("对方未响应（20 秒内无接受回执）", "warn");
				}
			}, WAIT_TIMEOUT_MS);
		} catch (e) {
			const msg = (e as Error)?.message || String(e);
			teardown();
			phase = "error";
			setStatus("连接失败：" + msg, "err");
			console.error(e);
		}
	}

	// 超时后再点「重试」= 对同一台设备重走一遍连接。
	function retry() {
		if (!selectedUid) return;
		void connect(selectedUid);
	}

	// ── 鼠标：移动/点击直接下发（相对坐标，被控端按比例还原）── 照旧页实现
	function relCoords(e: MouseEvent): { x: number; y: number } {
		// 用视频**内容区**（videoWidth/Height）而非元素盒子，避免黑边导致坐标偏移。
		const r = videoEl!.getBoundingClientRect();
		return {
			x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
			y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))
		};
	}
	function onMove(e: MouseEvent) {
		if (!p2p) return;
		const { x, y } = relCoords(e);
		p2p.sendBehavior({ type: "mousemove", x, y });
	}
	function onDown(e: MouseEvent) {
		if (!p2p) return;
		const { x, y } = relCoords(e);
		p2p.sendBehavior({ type: "mousedown", button: e.button, x, y });
	}
	function onUp(e: MouseEvent) {
		if (!p2p) return;
		const { x, y } = relCoords(e);
		p2p.sendBehavior({ type: "mouseup", button: e.button, x, y });
	}

	// ── 键盘捕获开关：开启后把本页按键逐字符转发 ──
	function toggleKbd() {
		if (!p2p) {
			setStatus("请先连接设备，再开启键盘捕获", "warn");
			return;
		}
		if (kbdCapture) {
			if (kbdHandler) window.removeEventListener("keydown", kbdHandler, true);
			kbdHandler = null;
			kbdCapture = false;
			toast.message("已关闭键盘捕获");
			return;
		}
		kbdHandler = (e: KeyboardEvent) => {
			if (!p2p) return;
			// 捕获全部按键并阻止其在本页产生副作用（粘贴/快捷键等）。
			e.preventDefault();
			e.stopPropagation();
			p2p.sendBehavior({ type: "key", key: e.key });
		};
		window.addEventListener("keydown", kbdHandler, true);
		kbdCapture = true;
		toast.message("键盘捕获已开启：按键将下发到被控设备（再次点击关闭）");
	}

	function sendCad() {
		if (!p2p) {
			setStatus("请先连接设备", "warn");
			return;
		}
		p2p.sendBehavior({ type: "cad" });
	}

	function fullscreen() {
		if (videoEl?.requestFullscreen) void videoEl.requestFullscreen();
	}

	function onQuality() {
		if (p2p) p2p.sendBehavior({ type: "quality", value: quality });
	}

	const statusClass = $derived(
		statusKind === "ok"
			? "text-emerald-600 dark:text-emerald-400"
			: statusKind === "warn"
				? "text-amber-600 dark:text-amber-400"
				: statusKind === "err"
					? "text-destructive"
					: "text-muted-foreground"
	);
	const busy = $derived(phase === "token" || phase === "connecting");
	const sessionActive = $derived(!!selectedUid && (phase === "waiting" || phase === "accepted" || phase === "timeout"));
</script>

<svelte:head>
	<title>远程控制 · 集控面板 | Stelarith</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
	<div class="flex items-center gap-3">
		<div class="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
			<ScreenShare class="size-5" />
		</div>
		<div>
			<h1 class="font-heading text-lg font-semibold">远程控制</h1>
			<p class="text-xs text-muted-foreground">
				基于 WebRTC 的教室桌面远控。选择一台<b>在线</b>设备发起连接，对方接受后即可接管。
			</p>
		</div>
	</div>

	<!-- 权限说明：服务端已按 remote 档门控，能进本页即具备权限；此处仅作知情提示。 -->
	<div
		class="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
	>
		<ShieldAlert class="mt-0.5 size-3.5 shrink-0" />
		<span>
			远程控制可查看并操作教室桌面，属敏感能力（需「远控」权限档位）。连接成功仅代表信令接通，
			<b>必须等对方接受</b>才能看到画面。
		</span>
	</div>

	<!-- ① 设备选择 -->
	<Card>
		<CardHeader>
			<div class="flex flex-wrap items-center justify-between gap-2">
				<div>
					<CardTitle class="flex items-center gap-2">
						<MonitorSmartphone class="size-4" /> 选择设备
					</CardTitle>
					<CardDescription>离线设备无法发起远控（连了也只会白等），已置灰。</CardDescription>
				</div>
				<Button variant="outline" size="sm" onclick={loadDevices} disabled={devLoading}>
					{#if devLoading}<Loader2 class="mr-1.5 size-3.5 animate-spin" />{:else}<RefreshCw class="mr-1.5 size-3.5" />{/if}
					刷新
				</Button>
			</div>
		</CardHeader>
		<CardContent>
			{#if devLoading}
				<div class="flex items-center justify-center py-6 text-sm text-muted-foreground">
					<Loader2 class="mr-2 size-4 animate-spin" /> 正在读取设备列表…
				</div>
			{:else if devError}
				<div class="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
					<WifiOff class="mt-0.5 size-4 shrink-0 text-destructive" />
					<div class="text-sm">
						<p class="font-medium text-destructive">设备列表加载失败</p>
						<p class="mt-1 text-xs text-muted-foreground">{devError}</p>
					</div>
				</div>
			{:else if devices.length === 0}
				<div class="rounded-lg border border-border/60 bg-muted/40 p-4 text-sm text-muted-foreground">
					当前账号范围内没有可远控的设备（可能未绑定班级，或代理按权限返回空列表）。
				</div>
			{:else}
				<div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
					{#each devices as d (d.id)}
						<div
							class="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-card p-3"
						>
							<div class="min-w-0">
								<div class="flex items-center gap-2">
									<span class="truncate text-sm font-medium">{d.host || d.id}</span>
									{#if d.online}
										<Badge variant="secondary" class="gap-1 text-emerald-600 dark:text-emerald-400">
											<CircleCheck class="size-3" /> 在线
										</Badge>
									{:else}
										<Badge variant="secondary" class="gap-1 text-muted-foreground">
											<WifiOff class="size-3" /> 离线
										</Badge>
									{/if}
								</div>
								<div class="mt-0.5 truncate text-xs text-muted-foreground">
									{d.id}{d.className ? ` · ${d.className}` : ""}
								</div>
							</div>
							<Button
								size="sm"
								disabled={!d.online || busy || (sessionActive && selectedUid === d.id)}
								title={d.online ? "发起远控" : "设备离线，无法连接"}
								onclick={() => connect(d.id)}
							>
								{#if busy && selectedUid === d.id}
									<Loader2 class="mr-1 size-3.5 animate-spin" /> 连接中
								{:else if sessionActive && selectedUid === d.id}
									连接中
								{:else}
									<Play class="mr-1 size-3.5" /> 连接
								{/if}
							</Button>
						</div>
					{/each}
				</div>
			{/if}
		</CardContent>
	</Card>

	<!-- ② 画面 + 状态 -->
	<Card>
		<CardHeader>
			<div class="flex flex-wrap items-center justify-between gap-2">
				<CardTitle class="flex items-center gap-2">
					<ScreenShare class="size-4" /> 远端画面
					{#if selectedUid}<span class="text-xs font-normal text-muted-foreground">（{selectedUid}）</span>{/if}
				</CardTitle>
				<div class="flex items-center gap-1.5 text-sm {statusClass}" aria-live="polite">
					<span aria-hidden="true">●</span>
					<span class="font-medium">{statusMsg}</span>
				</div>
			</div>
		</CardHeader>
		<CardContent>
			<div class="relative flex min-h-[320px] items-center justify-center overflow-hidden rounded-lg bg-black">
				<video
					bind:this={videoEl}
					autoplay
					playsinline
					class="max-h-[70vh] w-full"
					style={mediaLive ? "display:block" : "display:none"}
					onmousemove={onMove}
					onmousedown={onDown}
					onmouseup={onUp}
				></video>
				{#if !mediaLive}
					<div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 text-center text-sm text-muted-foreground">
						{#if phase === "token"}
							<Loader2 class="size-5 animate-spin" />
							<span>正在获取信令令牌…</span>
						{:else if phase === "connecting"}
							<Loader2 class="size-5 animate-spin" />
							<span>正在连接信令服务器…</span>
						{:else if phase === "waiting"}
							<Loader2 class="size-5 animate-spin" />
							<span>已进入信令房间，等待对方响应…</span>
							<span class="text-xs">（信令已连通 ≠ 对方已接受，画面需对方接受后出现）</span>
						{:else if phase === "timeout"}
							<TriangleAlert class="size-5 text-amber-500" />
							<span>对方未响应（20 秒内无接受回执）</span>
							<Button size="sm" variant="outline" class="pointer-events-auto mt-1" onclick={retry}>
								<RefreshCw class="mr-1 size-3.5" /> 重试
							</Button>
						{:else if phase === "error"}
							<TriangleAlert class="size-5 text-destructive" />
							<span class="text-destructive">{statusMsg}</span>
							{#if selectedUid}
								<Button size="sm" variant="outline" class="pointer-events-auto mt-1" onclick={retry}>
									<RefreshCw class="mr-1 size-3.5" /> 重试
								</Button>
							{/if}
						{:else}
							<ScreenShare class="size-5" />
							<span>在上方选择一台在线设备并点击「连接」</span>
							<span class="text-xs">远控画面将显示在这里</span>
						{/if}
					</div>
				{/if}
			</div>
		</CardContent>
	</Card>

	<!-- ③ 控制条 -->
	<Card>
		<CardContent class="flex flex-wrap items-center gap-2 pt-5">
			<Button variant="outline" size="sm" onclick={disconnect} disabled={!selectedUid}>
				<Power class="mr-1.5 size-3.5" /> 断开
			</Button>
			<Button
				variant={kbdCapture ? "default" : "outline"}
				size="sm"
				onclick={toggleKbd}
				disabled={!p2p}
				title="开启后本页按键将转发到被控设备"
			>
				<Keyboard class="mr-1.5 size-3.5" /> {kbdCapture ? "键盘捕获：开" : "键盘捕获：关"}
			</Button>
			<Button variant="outline" size="sm" onclick={sendCad} disabled={!p2p}>
				Ctrl+Alt+Del
			</Button>
			<Button variant="outline" size="sm" onclick={fullscreen} disabled={!mediaLive}>
				<Maximize class="mr-1.5 size-3.5" /> 全屏
			</Button>
			<div class="ml-auto flex items-center gap-2">
				<label for="quality" class="text-xs text-muted-foreground">画质</label>
				<select
					id="quality"
					bind:value={quality}
					onchange={onQuality}
					class="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
				>
					<option value="high">高</option>
					<option value="balanced">均衡</option>
					<option value="low">流畅</option>
				</select>
			</div>
		</CardContent>
		<p class="px-6 pb-5 text-xs text-muted-foreground">
			连上后：鼠标在画面上移动/点击即下发；开启「键盘捕获」后在本页按键即转发；画质为向被控端透传的编码意图（真实质量由教室端编码参数决定）。
		</p>
	</Card>
</div>
