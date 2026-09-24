<script lang="ts">
	// 老师页（T09 第一步）：手机竖屏布局。
	// 顶部「教室现在的画面」+ 三个零输入大按钮（拍照 / 发通知 / 关机）。
	// 权限遵循服务端硬校验，本页只做体验层门控（无权限按钮禁用并说明原因）。
	import { onMount } from "svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	// ── 状态 ──────────────────────────────────────────────
	type Dev = {
		id: string;
		host: string;
		hostKnown: boolean;
		online: boolean;
		reported: boolean;
		stateLabel: string;
		stateKind: string;
		classId: string;
		className: string;
	};

	let accountId = $state("");
	let devices = $state<Dev[]>([]);
	let devicesLoading = $state(true);
	let devicesError = $state("");
	let classLabel = $state(data.className || "");
	// 最新截图缩略图（页面加载时顺手拉第一台设备的）
	let lastCapture = $state<{ at: string; bytes: number; image_base64: string } | null>(null);

	// 操作状态
	let busy = $state(false);
	let statusMsg = $state("");
	let statusKind = $state<"ok" | "err" | "info">("info");
	// 选中的设备（默认第一台在线）
	let selectedId = $state("");

	// 弹窗
	let dialog = $state<"none" | "photo" | "notify" | "shutdown">("none");
	let photoSrc = $state("");
	let photoInfo = $state("");
	let notifyTitle = $state("");
	let notifyContent = $state("");
	let notifySeconds = $state("10");

	function esc(s: unknown): string {
		return String(s ?? "").replace(/[&<>"']/g, (c) => ({
			"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
		}[c]!));
	}

	function sleep(ms: number) {
		return new Promise((r) => setTimeout(r, ms));
	}

	function setStatus(msg: string, kind: "ok" | "err" | "info" = "info") {
		statusMsg = msg;
		statusKind = kind;
	}

	function normDevice(d: Record<string, unknown>): Dev {
		const online = !!d.online;
		const reported = !!d.reported;
		const host = String(d.host || "");
		return {
			id: String(d.client_id || ""),
			host,
			hostKnown: !!host,
			online,
			reported,
			stateLabel: !reported ? "尚未接入" : online ? "在线" : "离线",
			stateKind: !reported ? "warn" : online ? "ok" : "err",
			classId: String(d.class_id || ""),
			className: String(d.class_name || "")
		};
	}

	async function loadAccount() {
		try {
			const r = await fetch("/api/console/cims/account/list", { credentials: "same-origin" });
			if (r.ok) {
				const list = (await r.json()) as Array<{ id?: string | number }>;
				if (Array.isArray(list) && list.length) accountId = String(list[0].id ?? "");
			}
		} catch {
			/* 读不到账户 → 下发动作会被代理拦下，由错误提示说明 */
		}
	}

	async function loadDevices() {
		devicesLoading = true;
		devicesError = "";
		try {
			const r = await fetch("/api/console/cims/class/device-status", { credentials: "same-origin" });
			if (r.ok) {
				const d = (await r.json()) as { devices?: unknown[] };
				devices = Array.isArray(d.devices) ? d.devices.map((x) => normDevice(x as Record<string, unknown>)) : [];
			} else if (r.status === 403) {
				devicesError = "没有设备观看权限（本班画面需班主任/电教委员）";
			} else {
				devicesError = "设备状态获取失败（HTTP " + r.status + "）";
			}
		} catch {
			devicesError = "设备状态获取失败（网络错误）";
		}
		devicesLoading = false;
		const onlineDev = devices.find((x) => x.online) || devices[0];
		if (onlineDev && !selectedId) selectedId = onlineDev.id;
		// 顺手拉本班第一台设备的最新截图做缩略图（有权限才有）
		await loadCaptureThumb(onlineDev);
	}

	async function loadCaptureThumb(dev?: Dev) {
		if (!dev) return;
		try {
			const q =
				"/api/console/ext/captures?uid=" +
				encodeURIComponent(dev.id) +
				(dev.host && dev.host !== dev.id ? "&host=" + encodeURIComponent(dev.host) : "");
			const r = await fetch(q, { credentials: "same-origin" });
			if (r.ok) {
				const j = (await r.json()) as { capture?: { at: string; bytes: number; image_base64: string } };
				if (j.capture) lastCapture = j.capture;
			}
		} catch {
			/* 缩略图拉取失败不打扰 */
		}
	}

	// ── stelarith_task 签名：优先网站签名端点（服务端 Ed25519），失败回落时间戳占位（联调）─
	async function signTask(action: string, ts: number): Promise<string> {
		try {
			const r = await fetch("/api/console/sign-task", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action, ts }),
				credentials: "same-origin"
			});
			if (r.ok) {
				const j = (await r.json()) as { ok?: boolean; token?: string };
				if (j.ok && j.token) return j.token;
			}
		} catch {
			/* 签名端点不可达 → 占位 */
		}
		return String(ts);
	}

	// 经 CIMS send-notification 下发 stelarith_task（与面板 deviceAction 同一链路）
	async function sendDeviceTask(uid: string, action: string): Promise<{ ok: boolean; status: string; message?: string }> {
		if (!accountId) return { ok: false, status: "error", message: "未取得操作账户，无法下发" };
		const ts = Math.floor(Date.now() / 1000);
		const token = await signTask(action, ts);
		const task = { action, token, scope: "device", ts };
		const body = JSON.stringify({ MessageContent: JSON.stringify({ stelarith_task: task }) });
		try {
			const r = await fetch(
				"/api/console/cims/account/" + encodeURIComponent(accountId) + "/client/" + encodeURIComponent(uid) + "/command/send-notification",
				{ method: "POST", headers: { "Content-Type": "application/json" }, body, credentials: "same-origin" }
			);
			const j = (await r.json().catch(() => ({}))) as { status?: string; message?: string };
			// 远端用 HTTP 200 表达业务失败 → 必须读回执体
			return { ok: r.ok && !(j.status === "error"), status: String(j.status || r.status || ""), message: j.message || "" };
		} catch {
			return { ok: false, status: "error", message: "下发请求失败（网络错误）" };
		}
	}

	// 轮询截图回传：双 key（client_id + host=agent 的 UID），20s 超时
	async function pollCapture(uid: string, host: string, tries = 10): Promise<{ at: string; bytes: number; image_base64: string } | null> {
		for (let i = 0; i < tries; i++) {
			await sleep(2000);
			try {
				const q =
					"/api/console/ext/captures?uid=" +
					encodeURIComponent(uid) +
					(host && host !== uid ? "&host=" + encodeURIComponent(host) : "");
				const r = await fetch(q, { credentials: "same-origin" });
				if (r.ok) {
					const j = (await r.json()) as { capture?: { at: string; bytes: number; image_base64: string } };
					if (j.capture) return j.capture;
				}
			} catch {
				/* 单次轮询失败继续 */
			}
		}
		return null;
	}

	// ── 三个零输入动作 ───────────────────────────────────
	async function takePhoto() {
		const dev = devices.find((x) => x.id === selectedId) || devices[0];
		if (!dev) return setStatus("本班没有可用设备，无法拍照", "err");
		busy = true;
		setStatus("正在向 " + esc(dev.id) + " 下发拍照指令…", "info");
		const r = await sendDeviceTask(dev.id, "screenshot");
		if (!r.ok) {
			busy = false;
			return setStatus("拍照指令被拒：" + (r.message || r.status), "err");
		}
		setStatus("指令已下发，等待教室端回传画面…（20 秒内）", "info");
		const cap = await pollCapture(dev.id, dev.host);
		busy = false;
		if (cap) {
			photoSrc = "data:image/png;base64," + cap.image_base64;
			photoInfo = "收到 " + esc(dev.id) + " 的截图（" + cap.bytes + " bytes）";
			lastCapture = cap;
			dialog = "photo";
			setStatus("");
		} else {
			setStatus("20 秒内未收到截图回传：请确认教室端 agent 在线且已配置截图回传。", "err");
		}
	}

	async function sendNotify() {
		if (!notifyTitle.trim()) return setStatus("通知标题不能为空", "err");
		if (!data.can.broadcast) return setStatus("当前账号没有发通知权限", "err");
		busy = true;
		setStatus("正在向本班下发通知…", "info");
		try {
			const body: Record<string, unknown> = {
				title: notifyTitle,
				content: notifyContent,
				scope: "本班",
				broadcast: true,
				duration_seconds: Number(notifySeconds) || 10
			};
			// 只发本班：classes 传绑定班级名（服务端对 L2/班级档仍会独立收敛校验）
			if (data.className) body.classes = [data.className];
			const r = await fetch("/api/console/ext/notices", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
				credentials: "same-origin"
			});
			const j = (await r.json().catch(() => ({}))) as { error?: string; status?: string };
			if (r.ok) {
				setStatus("通知已下发到本班教室大屏（" + (data.className || "本班") + "）", "ok");
				notifyTitle = "";
				notifyContent = "";
				dialog = "none";
			} else {
				setStatus("通知下发失败：" + (j.error || "HTTP " + r.status), "err");
			}
		} catch {
			setStatus("通知下发请求失败（网络错误）", "err");
		} finally {
			busy = false;
		}
	}

	async function doShutdown() {
		const dev = devices.find((x) => x.id === selectedId) || devices[0];
		if (!dev) return setStatus("本班没有可用设备", "err");
		busy = true;
		setStatus("正在向 " + esc(dev.id) + " 下发关机指令…", "info");
		const r = await sendDeviceTask(dev.id, "shutdown");
		busy = false;
		dialog = "none";
		if (r.ok) {
			setStatus("关机指令已下发至 " + esc(dev.id) + "（教室端执行结果见设备回执）", "ok");
		} else {
			setStatus("关机指令被拒：" + (r.message || r.status), "err");
		}
	}

	onMount(() => {
		loadAccount();
		loadDevices();
	});

	const canPhoto = data.can.remote;
	const canNotify = data.can.broadcast;
	const canShutdown = data.can.remote;

	// 权限缺失说明（按钮禁用时 title 展示原因）
	function gateTitle(kind: string): string {
		if (kind === "photo") return canPhoto ? "" : "无『远程控制』权限：拍照需班主任/电教委员（带班老师请联系班主任操作）";
		if (kind === "notify") return canNotify ? "" : "无广播权限";
		if (kind === "shutdown") return canShutdown ? "" : "无『远程控制』权限：关机需班主任/电教委员";
		return "";
	}
</script>

<svelte:head>
	<title>星集控 · 老师页</title>
	<meta name="robots" content="noindex,nofollow" />
</svelte:head>

<div class="teacher-page">
	<!-- 顶部身份条 -->
	<header class="tp-head">
		<div class="tp-brand">
			<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="14" rx="2"></rect><path d="M8 21h8M12 18v3"></path></svg>
			<span>星集控 · 老师页</span>
		</div>
		<div class="tp-id">
			<span class="tp-role">{esc(data.roleLabel)}</span>
			<span class="tp-user">{esc(data.user)}</span>
		</div>
	</header>

	<!-- 教室现在的画面 -->
	<section class="tp-stage" aria-label="教室现在的画面">
		<h2 class="tp-sec">
			<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="20" height="14" rx="2"></rect><path d="M8 21h8M12 17v4"></path></svg>
			教室现在的画面
		</h2>
		{#if data.className}
			<div class="tp-class">当前班级：{esc(data.className)}</div>
		{/if}

		{#if devicesLoading}
			<div class="tp-empty">正在读取本班设备…</div>
		{:else if devicesError}
			<div class="tp-empty tp-err">{esc(devicesError)}</div>
		{:else if devices.length === 0}
			<div class="tp-empty">本班暂无设备{data.can.watch ? "" : "（没有设备观看权限，需班主任/电教委员）"}。</div>
		{:else}
			<div class="tp-devices" role="list">
				{#each devices as d (d.id)}
					<button
						type="button"
						class="tp-dev"
						class:sel={d.id === selectedId}
						disabled={!data.can.watch}
						onclick={() => { selectedId = d.id; }}
						role="listitem"
					>
						<span class="tp-dev-name">{esc(d.id)}</span>
						<span class="tp-dot tp-dot-{d.stateKind}"></span>
						<span class="tp-dev-state">{esc(d.stateLabel)}</span>
					</button>
				{/each}
			</div>
			{#if lastCapture}
				<button type="button" class="tp-thumb" onclick={() => { photoSrc = "data:image/png;base64," + lastCapture.image_base64; photoInfo = "最近一次截图（" + lastCapture.bytes + " bytes）"; dialog = "photo"; }} aria-label="查看最近截图">
					<img src="data:image/png;base64,{lastCapture.image_base64}" alt="最近截图缩略图" loading="lazy" />
					<span>最近截图 · 点击放大</span>
				</button>
			{/if}
		{/if}
	</section>

	<!-- 三个零输入大按钮 -->
	<section class="tp-actions" aria-label="快捷操作">
		<button type="button" class="tp-big" class:disabled={!canPhoto} disabled={!canPhoto} title={gateTitle("photo")} onclick={takePhoto}>
			<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
			<span class="tp-big-label">拍照</span>
			<span class="tp-big-sub">{canPhoto ? "本班教室画面" : "需班主任/电教委员"}</span>
		</button>
		<button type="button" class="tp-big" class:disabled={!canNotify} disabled={!canNotify} title={gateTitle("notify")} onclick={() => { dialog = "notify"; }}>
			<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
			<span class="tp-big-label">发通知</span>
			<span class="tp-big-sub">推送到本班大屏</span>
		</button>
		<button type="button" class="tp-big tp-danger" class:disabled={!canShutdown} disabled={!canShutdown} title={gateTitle("shutdown")} onclick={() => { if (canShutdown) dialog = "shutdown"; }}>
			<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18.36 6.64A9 9 0 1 1 5.64 6.64"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>
			<span class="tp-big-label">关机</span>
			<span class="tp-big-sub">{canShutdown ? "关闭本班设备" : "需班主任/电教委员"}</span>
		</button>
	</section>

	<!-- 操作状态条 -->
	{#if statusMsg}
		<div class="tp-status tp-status-{statusKind}" role="status">{esc(statusMsg)}</div>
	{/if}

	{#if busy}
		<div class="tp-busy" role="status">处理中…</div>
	{/if}

	<!-- 弹窗：拍照结果 -->
	{#if dialog === "photo" && photoSrc}
		<div class="tp-dialog" onclick={(e) => { if (e.target === e.currentTarget) dialog = "none"; }}>
			<div class="tp-dialog-card" role="dialog" aria-label="截图查看">
				<div class="tp-dialog-head">
					<span>{esc(photoInfo)}</span>
					<button type="button" class="tp-x" onclick={() => { dialog = "none"; }} aria-label="关闭">✕</button>
				</div>
				<img class="tp-photo" src={photoSrc} alt="教室截图" />
				<div class="tp-dialog-foot">
					<button type="button" class="tp-btn" onclick={takePhoto}>重新拍照</button>
					<button type="button" class="tp-btn tp-btn-plain" onclick={() => { dialog = "none"; }}>关闭</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- 弹窗：发通知 -->
	{#if dialog === "notify"}
		<div class="tp-dialog" onclick={(e) => { if (e.target === e.currentTarget) dialog = "none"; }}>
			<div class="tp-dialog-card" role="dialog" aria-label="发送通知">
				<div class="tp-dialog-head">
					<span>发送本班通知</span>
					<button type="button" class="tp-x" onclick={() => { dialog = "none"; }} aria-label="关闭">✕</button>
				</div>
				<div class="tp-form">
					<label>标题<input type="text" maxlength="60" bind:value={notifyTitle} placeholder="例如：下节课请打开投影" /></label>
					<label>内容<textarea rows="3" maxlength="200" bind:value={notifyContent} placeholder="显示在教室大屏上的文字"></textarea></label>
					<label>显示时长（秒）<input type="number" min="3" max="3600" bind:value={notifySeconds} /></label>
				</div>
				<div class="tp-dialog-foot">
					<button type="button" class="tp-btn" disabled={busy} onclick={sendNotify}>发送到本班大屏</button>
					<button type="button" class="tp-btn tp-btn-plain" onclick={() => { dialog = "none"; }}>取消</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- 弹窗：关机确认 -->
	{#if dialog === "shutdown"}
		<div class="tp-dialog" onclick={(e) => { if (e.target === e.currentTarget) dialog = "none"; }}>
			<div class="tp-dialog-card" role="dialog" aria-label="关机确认">
				<div class="tp-dialog-head"><span>确认关机</span></div>
				<p class="tp-warn-text">
					将向 <b>{esc((devices.find((x) => x.id === selectedId) || devices[0])?.id ?? "")}</b>
					下发关机指令，教室一体机会关闭。确定继续？
				</p>
				<div class="tp-dialog-foot">
					<button type="button" class="tp-btn tp-danger-btn" disabled={busy} onclick={doShutdown}>确认关机</button>
					<button type="button" class="tp-btn tp-btn-plain" onclick={() => { dialog = "none"; }}>取消</button>
				</div>
			</div>
		</div>
	{/if}

	<footer class="tp-foot">
		<a href="/admin/console">打开完整集控面板 →</a>
	</footer>
</div>

<style>
	/* 老师页专用样式：手机竖屏为主，桌面也兼容。不依赖站点主题令牌，自带色板。 */
	.teacher-page {
		--tp-bg: #f4f3ee;
		--tp-card: #ffffff;
		--tp-ink: #1c1b18;
		--tp-muted: #6b6962;
		--tp-line: #e2e0d8;
		--tp-accent: #e8b23d;
		--tp-accent-ink: #3a2c08;
		--tp-danger: #d94f3d;
		--tp-ok: #3d9a5b;
		--tp-warn: #d9942f;
		--tp-err: #d94f3d;
		min-height: 100dvh;
		background: var(--tp-bg);
		color: var(--tp-ink);
		display: flex;
		flex-direction: column;
		max-width: 560px;
		margin: 0 auto;
		padding: 12px 14px calc(20px + env(safe-area-inset-bottom));
		gap: 12px;
		font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
	}
	:global(.dark) .teacher-page {
		--tp-bg: #17170f;
		--tp-card: #232218;
		--tp-ink: #f0eee4;
		--tp-muted: #a5a297;
		--tp-line: #33321f;
		--tp-accent: #d9a52e;
		--tp-accent-ink: #221b05;
	}
	.tp-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.tp-brand {
		display: flex;
		align-items: center;
		gap: 8px;
		font-weight: 700;
		font-size: 16px;
	}
	.tp-id { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--tp-muted); }
	.tp-role {
		background: var(--tp-accent);
		color: var(--tp-accent-ink);
		padding: 2px 8px;
		border-radius: 999px;
		font-weight: 600;
	}
	.tp-stage, .tp-actions {
		background: var(--tp-card);
		border: 1px solid var(--tp-line);
		border-radius: 14px;
		padding: 12px;
	}
	.tp-sec {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 14px;
		font-weight: 600;
		margin: 0 0 8px;
	}
	.tp-class { font-size: 12px; color: var(--tp-muted); margin-bottom: 8px; }
	.tp-empty { font-size: 13px; color: var(--tp-muted); padding: 10px 4px; }
	.tp-err { color: var(--tp-err); }
	.tp-devices { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
	.tp-dev {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		border: 1px solid var(--tp-line);
		border-radius: 10px;
		background: var(--tp-card);
		padding: 6px 10px;
		font-size: 13px;
		cursor: pointer;
	}
	.tp-dev.sel { border-color: var(--tp-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--tp-accent) 30%, transparent); }
	.tp-dev:disabled { opacity: 0.55; cursor: not-allowed; }
	.tp-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }
	.tp-dot-ok { background: var(--tp-ok); }
	.tp-dot-warn { background: var(--tp-warn); }
	.tp-dot-err { background: var(--tp-err); }
	.tp-dev-state { color: var(--tp-muted); font-size: 12px; }
	.tp-thumb {
		display: block;
		width: 100%;
		border: none;
		background: none;
		padding: 0;
		cursor: pointer;
		text-align: left;
	}
	.tp-thumb img { width: 100%; max-height: 160px; object-fit: cover; border-radius: 10px; border: 1px solid var(--tp-line); }
	.tp-thumb span { display: block; font-size: 12px; color: var(--tp-muted); margin-top: 4px; }
	.tp-actions {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 10px;
		padding: 12px;
	}
	.tp-big {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 16px 8px;
		border: 1px solid var(--tp-line);
		border-radius: 14px;
		background: var(--tp-card);
		cursor: pointer;
		transition: transform 0.12s ease, border-color 0.12s ease;
		min-height: 108px;
	}
	.tp-big:hover { border-color: var(--tp-accent); }
	.tp-big:active { transform: scale(0.97); }
	.tp-big.disabled { opacity: 0.45; cursor: not-allowed; }
	.tp-big.disabled:hover { border-color: var(--tp-line); }
	.tp-big-label { font-size: 16px; font-weight: 700; }
	.tp-big-sub { font-size: 11px; color: var(--tp-muted); text-align: center; }
	.tp-danger { border-color: color-mix(in srgb, var(--tp-danger) 40%, var(--tp-line)); }
	.tp-danger:not(.disabled):hover { border-color: var(--tp-danger); }
	.tp-status {
		font-size: 13px;
		padding: 9px 12px;
		border-radius: 10px;
		background: var(--tp-card);
		border: 1px solid var(--tp-line);
	}
	.tp-status-ok { color: var(--tp-ok); border-color: color-mix(in srgb, var(--tp-ok) 45%, var(--tp-line)); }
	.tp-status-err { color: var(--tp-err); border-color: color-mix(in srgb, var(--tp-err) 45%, var(--tp-line)); }
	.tp-busy { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); background: var(--tp-card); border: 1px solid var(--tp-line); border-radius: 999px; padding: 8px 18px; font-size: 13px; box-shadow: 0 8px 30px rgba(0,0,0,0.18); z-index: 60; }
	.tp-dialog {
		position: fixed;
		inset: 0;
		background: rgba(0,0,0,0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
		z-index: 50;
	}
	.tp-dialog-card {
		background: var(--tp-card);
		color: var(--tp-ink);
		border-radius: 14px;
		width: 100%;
		max-width: 480px;
		max-height: 90dvh;
		overflow-y: auto;
		padding: 14px;
		box-shadow: 0 16px 60px rgba(0,0,0,0.3);
	}
	.tp-dialog-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-weight: 600;
		font-size: 15px;
		margin-bottom: 10px;
	}
	.tp-x { border: none; background: none; font-size: 16px; cursor: pointer; color: var(--tp-muted); padding: 4px 8px; }
	.tp-photo { width: 100%; border-radius: 10px; border: 1px solid var(--tp-line); }
	.tp-dialog-foot { display: flex; gap: 8px; margin-top: 12px; }
	.tp-btn {
		flex: 1;
		border: none;
		background: var(--tp-accent);
		color: var(--tp-accent-ink);
		font-weight: 700;
		font-size: 14px;
		padding: 10px 12px;
		border-radius: 10px;
		cursor: pointer;
	}
	.tp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.tp-btn-plain { background: transparent; border: 1px solid var(--tp-line); color: var(--tp-ink); font-weight: 500; }
	.tp-danger-btn { background: var(--tp-danger); color: #fff; }
	.tp-form { display: flex; flex-direction: column; gap: 10px; }
	.tp-form label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--tp-muted); }
	.tp-form input, .tp-form textarea {
		border: 1px solid var(--tp-line);
		border-radius: 8px;
		padding: 8px 10px;
		font-size: 14px;
		background: var(--tp-card);
		color: var(--tp-ink);
		font-family: inherit;
	}
	.tp-warn-text { font-size: 14px; line-height: 1.6; color: var(--tp-muted); }
	.tp-warn-text b { color: var(--tp-ink); }
	.tp-foot { text-align: center; font-size: 13px; }
	.tp-foot a { color: var(--tp-accent); text-decoration: none; }
	.tp-foot a:hover { text-decoration: underline; }

	/* 超窄屏（<360px）：按钮高度收紧保证一屏内 */
	@media (max-width: 380px) {
		.tp-big { min-height: 96px; padding: 12px 6px; }
		.teacher-page { padding: 10px 10px 16px; gap: 10px; }
	}
</style>
