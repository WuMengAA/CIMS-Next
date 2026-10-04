<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import {
		ScrollText,
		RefreshCw,
		Loader2,
		CircleCheck,
		CircleX,
		Copy,
		Search,
		TriangleAlert,
		Info
	} from "@lucide/svelte";
	import type { PageData } from "./$types";

	// 设备日志（2026-09-27）：选一台教室机，看它（星集控桌面端）最近的运行日志。
	//
	// 下发通道照 devices / apps 页：sign-task 签名 → stelarith_task 经 send-notification 下发，
	// 结果靠「回执单」拿回来（先 POST /api/console/control/tasks 建单，再轮询查询等设备回报）。
	//
	// 与软件管控不同，log_tail 由桌面端**本地读自己的日志文件**（不经过 Rust agent），
	// 所以 agent 挂掉时依然可用 —— 这正是「agent 为什么没起来」能被看到的唯一前提。
	//
	// 权限由服务端两道闸门裁决（sign-task + cims 代理动作级），本页只按 data.can 渲染，
	// 绝不自行判断能不能看日志。脱敏已在桌面端出口做完（面板拿到的就是处理后的原文）。
	let { data }: { data: PageData } = $props();

	type Dev = {
		id: string;
		host: string;
		cls: string;
		online: boolean;
		reported: boolean;
		ageSec: number | null;
	};

	type TaskRow = { state: string; result: string; extra: string; updated_at: string };

	// 已解析的一条日志：三列（时间 / 类别 / 内容）+ 原始整行（复制全文用）。
	// 内容与级别原文一律不翻译 —— 要发给维护者的是「现场原文」，只是类别列给人话。
	type LogRow = {
		raw: string;
		time: string;
		level: string;
		tag: string;
		content: string;
		cat: string;
		tone: "error" | "warn" | "api" | "info";
	};

	// idle=未取 / loading=等回执 / ready=有数据 / empty=确实没有日志 /
	// offline=设备不在线 / oldver=桌面端版本较旧（引导语气，不是报错）/
	// timeout=设备超时未回应 / error=失败（人话 + 重试）
	type Phase = "idle" | "loading" | "ready" | "empty" | "offline" | "oldver" | "timeout" | "error";

	let devices = $state<Dev[]>([]);
	let devLoading = $state(true);
	let devErr = $state("");
	let selId = $state("");

	let rows = $state<LogRow[]>([]);
	let phase = $state<Phase>("idle");
	let msg = $state("");
	let totalCount = $state(0);
	let errCount = $state(0);
	let warnCount = $state(0);
	let logFile = $state("");
	let logSource = $state("");
	let truncated = $state(false);
	let fetchedAtMs = $state<number | null>(null);
	let copied = $state(false);
	let copyErr = $state("");

	// 过滤在前端做（数据已经在手，不必再向设备要一次）。
	let scope = $state<"all" | "problems">("all");
	let query = $state("");

	// 轮询世代号：切设备/重新取日志时自增，旧轮询自动作废。
	let gen = 0;
	// 每 5 秒驱动一次「N 秒前」的相对时间刷新。
	let tick = $state(0);
	let timer: ReturnType<typeof setInterval> | null = null;

	const POLL_MS = 2500; // 下发后隔多久问一次
	const POLL_MAX_MS = 5 * 60 * 1000 + 20 * 1000; // 服务端 5 分钟判死，留一点缓冲

	const selDev = $derived(devices.find((d) => d.id === selId) ?? null);

	// ---- 设备列表（沿用 devices / apps 页的数据源）----
	async function loadDevices() {
		devLoading = true;
		devErr = "";
		try {
			// 2026-10-05：自有 device-status（合并 bindings+云端），形态与 CIMS 兼容
			const r = await fetch("/api/console/control/device-status", { credentials: "same-origin" });
			const j = await r.json().catch(() => ({}));
			if (!r.ok) throw new Error(j?.error ? String(j.error) : `设备列表加载失败（错误码 ${r.status}）`);
			const list = Array.isArray(j.devices) ? j.devices : [];
			devices = list.map(norm);
			if (!selId && devices.length) selId = devices[0].id;
		} catch (e) {
			devErr = (e as Error)?.message || "设备列表加载失败";
		} finally {
			devLoading = false;
		}
	}

	function norm(d: Record<string, unknown>): Dev {
		const reported = !!d.reported;
		return {
			id: String(d.client_id ?? ""),
			host: String(d.host ?? ""),
			cls: String(d.class_name ?? d.class_id ?? ""),
			online: !!d.online,
			reported,
			ageSec: reported && typeof d.age_seconds === "number" && isFinite(d.age_seconds) ? d.age_seconds : null
		};
	}

	function ago(sec: number | null): string {
		if (sec === null) return "从未上报";
		if (sec < 60) return sec + " 秒前";
		if (sec < 3600) return Math.floor(sec / 60) + " 分钟前";
		if (sec < 86400) return Math.floor(sec / 3600) + " 小时前";
		return Math.floor(sec / 86400) + " 天前";
	}

	// 取到日志后经过了多久（「取自 … · 2 秒前」那一段）。
	const takenAgo = $derived.by(() => {
		void tick;
		if (!fetchedAtMs) return "";
		const s = Math.max(0, Math.floor((Date.now() - fetchedAtMs) / 1000));
		if (s < 5) return "刚刚";
		if (s < 60) return s + " 秒前";
		if (s < 3600) return Math.floor(s / 60) + " 分钟前";
		return Math.floor(s / 3600) + " 小时前";
	});

	function resetResult() {
		rows = [];
		phase = "idle";
		msg = "";
		totalCount = 0;
		errCount = 0;
		warnCount = 0;
		logFile = "";
		logSource = "";
		truncated = false;
		fetchedAtMs = null;
		copied = false;
		copyErr = "";
	}

	function onDeviceChange() {
		gen++;
		resetResult();
		scope = "all";
		query = "";
	}

	// ---- 指令签名（失败必须带原因：老师看不到签名失败会以为"设备坏了"）----
	async function sign(action: string, ts: number): Promise<{ token: string; error: string }> {
		try {
			const r = await fetch("/api/console/sign-task", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action, ts }),
				credentials: "same-origin"
			});
			const j = await r.json().catch(() => ({}));
			if (r.ok && j?.ok && j.token) return { token: String(j.token), error: "" };
			return { token: "", error: j?.error ? String(j.error) : "指令签名失败，无法向设备下发指令" };
		} catch (e) {
			return { token: "", error: (e as Error)?.message || "指令签名失败，无法向设备下发指令" };
		}
	}

	// ---- 回执单：建单 / 查询 ----
	async function createTask(uid: string, kind: string): Promise<{ taskId: string; error: string }> {
		try {
			const r = await fetch("/api/console/control/tasks", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ uid, kind }),
				credentials: "same-origin"
			});
			const j = await r.json().catch(() => ({}));
			if (!r.ok) return { taskId: "", error: j?.error ? String(j.error) : `创建回执单失败（错误码 ${r.status}）` };
			const id = String(j?.task_id ?? "");
			if (!id) return { taskId: "", error: "创建回执单失败：服务端没有返回单号" };
			return { taskId: id, error: "" };
		} catch (e) {
			return { taskId: "", error: (e as Error)?.message || "创建回执单失败" };
		}
	}

	async function fetchTask(taskId: string): Promise<{ task: TaskRow | null; error: string }> {
		try {
			const r = await fetch(`/api/console/control/tasks?task_id=${encodeURIComponent(taskId)}`, {
				credentials: "same-origin"
			});
			const j = await r.json().catch(() => ({}));
			if (!r.ok) return { task: null, error: j?.error ? String(j.error) : `查询回执失败（错误码 ${r.status}）` };
			return { task: (j?.task ?? null) as TaskRow | null, error: "" };
		} catch (e) {
			return { task: null, error: (e as Error)?.message || "查询回执失败" };
		}
	}

	// ---- 下发取日志指令（log_tail 不带任何参数，见任务卡契约）----
	async function sendLogTail(deviceId: string, taskId: string): Promise<{ error: string }> {
		try {
			// 2026-10-05：走自有设备指令通道（云端 /api/instructions），不再经 CIMS send-notification
			const r = await fetch("/api/console/control/device-command", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ uid: deviceId, action: "log_tail", params: { task_id: taskId } })
			});
			const j = await r.json().catch(() => ({}));
			if (!r.ok) return { error: j?.detail ? String(j.detail) : `指令下发失败（错误码 ${r.status}）` };
			return { error: "" };
		} catch (e) {
			return { error: (e as Error)?.message || "指令下发失败" };
		}
	}

	// ---- 轮询等回执：pending 一直等，done/failed/timeout 即落定，超时也落定 ----
	async function pollTask(
		taskId: string,
		alive: () => boolean
	): Promise<{ row: TaskRow | null; expired: boolean; error: string }> {
		const start = Date.now();
		let lastErr = "";
		while (Date.now() - start < POLL_MAX_MS) {
			await new Promise((res) => setTimeout(res, POLL_MS));
			if (!alive()) return { row: null, expired: true, error: "" };
			const { task, error } = await fetchTask(taskId);
			if (!alive()) return { row: null, expired: true, error: "" };
			if (error) {
				lastErr = error;
				continue;
			}
			if (!task) return { row: null, expired: true, error: lastErr };
			if (task.state !== "pending") return { row: task, expired: false, error: "" };
		}
		return { row: null, expired: true, error: "" };
	}

	// ---- 行解析：`[15:17:03] INFO  agent | 指令 #123 已执行`（空格数不定）----
	// 认不出的整行当内容，级别留空 → 类别「日志」：绝不丢行，绝不伪造结构。
	const LINE_RE = /^\s*\[?(\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?)\]?\s+([A-Za-z]+)\s*([^\s|]+)?\s*\|\s?([\s\S]*)$/;

	// INFO 按 tag 细分（设备 / 指令 / 日志）——只影响「类别」这一列，内容一律原文。
	function infoCat(tag: string): string {
		const t = tag.toLowerCase();
		if (!t) return "日志";
		if (/(task|cmd|command|poll|ack|dispatch|receipt|queue)/.test(t)) return "指令";
		if (/(agent|device|tray|window|host|heartbeat|volume|screenshot)/.test(t)) return "设备";
		return "日志";
	}

	// 原始级别 → 面板人话类别（绝不给老师看英文枚举）。
	function classify(level: string, tag: string): { cat: string; tone: LogRow["tone"] } {
		const lv = level.toUpperCase();
		if (lv === "ERROR" || lv === "FATAL" || lv === "SEVERE") return { cat: "出问题", tone: "error" };
		if (lv === "WARN" || lv === "WARNING") return { cat: "注意", tone: "warn" };
		if (lv === "API" || lv === "HTTP") return { cat: "网络", tone: "api" };
		return { cat: infoCat(tag), tone: "info" };
	}

	function parseLine(raw: string): LogRow {
		const m = LINE_RE.exec(raw);
		if (!m) return { raw, time: "", level: "", tag: "", content: raw, cat: "日志", tone: "info" };
		const level = m[2] ?? "";
		const tag = m[3] ?? "";
		const { cat, tone } = classify(level, tag);
		return { raw, time: m[1] ?? "", level, tag, content: m[4] ?? "", cat, tone };
	}

	type Parsed = {
		rows: LogRow[];
		count: number;
		truncated: boolean;
		file: string;
		source: string;
		errCount: number;
		warnCount: number;
		hasLines: boolean;
	};

	// ---- 解析回执 extra（桌面端 detail JSON 原样搬进来的那份）----
	function parseLogs(extraRaw: string): Parsed {
		const empty: Parsed = {
			rows: [], count: 0, truncated: false, file: "", source: "", errCount: 0, warnCount: 0, hasLines: false
		};
		let obj: Record<string, unknown> | null = null;
		try {
			obj = extraRaw ? (JSON.parse(extraRaw) as Record<string, unknown>) : null;
		} catch {
			obj = null;
		}
		if (!obj || typeof obj !== "object") return empty;
		const hasLines = Array.isArray(obj.lines);
		const raw = hasLines ? (obj.lines as unknown[]) : [];
		const out: LogRow[] = [];
		for (const l of raw) if (typeof l === "string") out.push(parseLine(l));
		const sum = obj.summary && typeof obj.summary === "object" ? (obj.summary as Record<string, unknown>) : null;
		const cnt = Number(obj.count);
		const se = sum ? Number(sum.error) : NaN;
		const sw = sum ? Number(sum.warn) : NaN;
		return {
			rows: out,
			count: Number.isFinite(cnt) ? cnt : out.length,
			truncated: obj.truncated === true,
			file: String(obj.file ?? ""),
			source: String(obj.source ?? ""),
			errCount: Number.isFinite(se) ? se : out.filter((r) => r.tone === "error").length,
			warnCount: Number.isFinite(sw) ? sw : out.filter((r) => r.tone === "warn").length,
			hasLines
		};
	}

	// 失败原因 → 人话。四条失败态里「版本较旧」与「没有日志」必须专门认，不许原样抛红字。
	function failureOf(row: TaskRow): { phase: Phase; msg: string } {
		const r = (row.result || "").trim();
		if (r.includes("本机不支持的动作")) {
			return { phase: "oldver", msg: "这台机器上的星集控版本较旧，暂时看不了日志（需要升级）" };
		}
		if (/(日志|记录)/.test(r) && /(没有|不存在|为空|空文件|还没有)/.test(r)) {
			return { phase: "empty", msg: "这台机器还没产生日志记录" };
		}
		return { phase: "error", msg: r || "设备未能完成本次取日志，且没有给出原因。" };
	}

	// ---- 取日志：全套「建单 → 下发 → 等回执 → 解析」 ----
	async function fetchLogs() {
		if (!data.can.view) {
			phase = "error";
			msg = "当前角色没有「查看设备日志」能力";
			return;
		}
		const d = selDev;
		if (!d) {
			phase = "error";
			msg = "请先选择一台设备";
			return;
		}
		// 离线时明确说人话（带最后心跳），不空白、不转圈到底。
		if (!d.reported) {
			phase = "offline";
			msg = "这台机器还没有接入集控，暂时看不到它的日志。";
			return;
		}
		if (!d.online) {
			phase = "offline";
			msg = `这台机器现在不在线（最后心跳 ${ago(d.ageSec)}）`;
			return;
		}

		const mine = ++gen;
		const alive = () => mine === gen;
		resetResult();
		phase = "loading";

		const { taskId, error: ce } = await createTask(d.id, "log_tail");
		if (!alive()) return;
		if (ce) {
			phase = "error";
			msg = ce;
			return;
		}

		const { error: se } = await sendLogTail(d.id, taskId);
		if (!alive()) return;
		if (se) {
			phase = "error";
			msg = se;
			return;
		}

		const { row, expired, error: pe } = await pollTask(taskId, alive);
		if (!alive()) return;
		if (pe) {
			phase = "error";
			msg = pe;
			return;
		}
		if (expired || !row || row.state === "timeout") {
			phase = "timeout";
			msg = "这台机器 5 分钟没回应，可能已关机";
			return;
		}
		if (row.state === "failed") {
			const f = failureOf(row);
			phase = f.phase;
			msg = f.msg;
			return;
		}

		const p = parseLogs(row.extra);
		// 回执里根本没带 lines 字段 → 如实说明，绝不拿空的冒充「没有日志」。
		if (!p.hasLines) {
			phase = "error";
			msg = "设备回报里没有带上日志内容，当前回执通道拿不到日志数据。";
			return;
		}
		rows = p.rows;
		totalCount = p.count;
		errCount = p.errCount;
		warnCount = p.warnCount;
		truncated = p.truncated;
		logFile = p.file;
		logSource = p.source;
		fetchedAtMs = Date.now();
		phase = rows.length ? "ready" : "empty";
		if (!rows.length) msg = "这台机器还没产生日志记录";
	}

	// ---- 前端过滤 + 搜索（数据已在手）----
	const shown = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return rows.filter((r) => {
			if (scope === "problems" && r.tone !== "error" && r.tone !== "warn") return false;
			if (!q) return true;
			return (r.time + " " + r.cat + " " + r.level + " " + r.tag + " " + r.content).toLowerCase().includes(q);
		});
	});

	// 顶部总结行：有错才醒目，平顺时是安静的一行。
	const summaryTone = $derived(errCount > 0 ? "error" : warnCount > 0 ? "warn" : "ok");

	// 类别列配色：出问题红 / 注意黄 / 网络淡紫 / 其余常规灰蓝。
	const CAT_CLASS: Record<string, string> = {
		error: "text-red-600",
		warn: "text-amber-600",
		api: "text-violet-500",
		info: "text-slate-500"
	};

	// ---- 复制全文：把「时间+级别+tag+内容」原样带走给维护者 ----
	async function copyAll() {
		copyErr = "";
		const text = rows.map((r) => r.raw).join("\n");
		try {
			await navigator.clipboard.writeText(text);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			try {
				const ta = document.createElement("textarea");
				ta.value = text;
				ta.style.position = "fixed";
				ta.style.opacity = "0";
				document.body.appendChild(ta);
				ta.select();
				document.execCommand("copy");
				document.body.removeChild(ta);
				copied = true;
				setTimeout(() => (copied = false), 2000);
			} catch {
				copyErr = "复制失败，请手动选中列表复制";
			}
		}
	}

	onMount(() => {
		loadDevices();
		timer = setInterval(() => tick++, 5000);
	});
	onDestroy(() => {
		gen++;
		if (timer) clearInterval(timer);
	});
</script>

<svelte:head>
	<title>设备日志 · 集控面板 | Stelarith</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-6xl p-4 md:p-6">
	<div class="mb-5 flex items-center gap-3">
		<div class="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
			<ScrollText class="size-5" />
		</div>
		<div>
			<h1 class="font-heading text-lg font-semibold">设备日志</h1>
			<p class="text-xs text-muted-foreground">
				选一台教室电脑，看它最近的运行日志。出问题时可以「复制全文」，把这段记录原样发给维护的人。
			</p>
		</div>
	</div>

	{#if devLoading}
		<div class="flex items-center justify-center py-16 text-muted-foreground">
			<Loader2 class="mr-2 size-4 animate-spin" /> 正在加载设备…
		</div>
	{:else if devErr}
		<div class="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
			<span>设备列表加载失败：{devErr}</span>
			<Button variant="outline" size="sm" onclick={loadDevices}>重试</Button>
		</div>
	{:else if !data.can.view}
		<div class="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
			当前角色没有「查看设备日志」能力，无法使用本页。
		</div>
	{:else}
		<div class="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
			<!-- 设备选择 -->
			<div class="flex flex-wrap items-center gap-3">
				<label class="text-sm font-medium" for="logs-device">设备</label>
				<select
					id="logs-device"
					bind:value={selId}
					onchange={onDeviceChange}
					class="h-9 min-w-[240px] rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
				>
					{#if !devices.length}<option value="">（还没有可管理的设备）</option>{/if}
					{#each devices as d (d.id)}
						<option value={d.id}>{d.host || d.id}{d.cls ? ` · ${d.cls}` : ""}{d.online ? "" : "（离线）"}</option>
					{/each}
				</select>
			</div>

			<!-- 状态行 -->
			{#if selDev}
				<p class="mt-3 flex flex-wrap items-center gap-2 text-xs">
					<span class="font-medium text-foreground">{selDev.host || selDev.id}</span>
					<span class="text-muted-foreground">·</span>
					<span class={selDev.online ? "text-emerald-600" : "text-muted-foreground"}>
						{selDev.online ? "在线" : selDev.reported ? "离线" : "尚未接入"}
					</span>
					<span class="text-muted-foreground">·</span>
					<span class="text-muted-foreground">最后心跳 {ago(selDev.ageSec)}</span>
				</p>
			{/if}

			<!-- 操作行 + 总结 -->
			<div class="mt-4 flex flex-wrap items-center gap-3 border-t pt-4">
				<Button
					variant="outline"
					size="sm"
					onclick={fetchLogs}
					disabled={phase === "loading" || !selDev}
				>
					{#if phase === "loading"}
						<Loader2 class="mr-1.5 size-3.5 animate-spin" />
					{:else if phase === "ready" || phase === "empty"}
						<RefreshCw class="mr-1.5 size-3.5" />
					{:else}
						<ScrollText class="mr-1.5 size-3.5" />
					{/if}
					{phase === "ready" || phase === "empty" ? "重新取日志" : "取日志"}
				</Button>

				{#if phase === "loading"}
					<span class="text-xs text-muted-foreground">正在从教室机取日志…</span>
				{:else if phase === "ready" || phase === "empty"}
					<span
						class={"text-xs " +
							(summaryTone === "error"
								? "font-medium text-destructive"
								: summaryTone === "warn"
									? "font-medium text-amber-600"
									: "text-emerald-600")}
					>
						{totalCount > 0
							? `最近 ${totalCount} 行里有 ${errCount} 条出错、${warnCount} 条注意`
							: "没有读到日志行"}
					</span>
				{/if}
			</div>

			{#if (phase === "ready" || phase === "empty") && (logFile || fetchedAtMs)}
				<p class="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
					{#if logFile}
						<span>取自 {logFile}</span>
						<span>·</span>
					{/if}
					<span>{takenAgo}</span>
					{#if logSource === "memory"}
						<span class="inline-flex items-center gap-1 text-amber-600">
							<Info class="size-3.5" />今天还没有日志文件，取的是本次运行的临时记录
						</span>
					{/if}
				</p>
			{/if}

			<!-- 内容区 -->
			{#if phase === "idle"}
				<p class="py-10 text-center text-sm text-muted-foreground">
					点上面的「取日志」，看看这台机器最近发生了什么。
				</p>
			{:else if phase === "loading"}
				<div class="flex items-center justify-center py-10 text-sm text-muted-foreground">
					<Loader2 class="mr-2 size-4 animate-spin" /> 正在从教室机取日志…
				</div>
			{:else if phase === "offline"}
				<div class="mt-4 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">{msg}</div>
			{:else if phase === "oldver"}
				<div class="mt-4 flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm text-amber-700">
					<TriangleAlert class="mt-0.5 size-4 shrink-0" />
					<span>这台机器上的星集控版本较旧，暂时看不了日志（需要升级）。升级后这个页面就能正常显示它的日志了。</span>
				</div>
			{:else if phase === "timeout"}
				<div class="mt-4 flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
					<span>{msg}。可以点「重新取日志」再试一次。</span>
					<Button variant="outline" size="sm" onclick={fetchLogs}>重试</Button>
				</div>
			{:else if phase === "error"}
				<div class="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
					<CircleX class="size-4 shrink-0" />
					<span>{msg}</span>
					<Button variant="outline" size="sm" onclick={fetchLogs}>重试</Button>
				</div>
			{:else if phase === "empty"}
				<div class="mt-4 flex items-center gap-2 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
					<CircleCheck class="size-4 shrink-0 text-emerald-600" />
					<span>{msg || "这台机器还没产生日志记录"}</span>
				</div>
			{:else}
				<!-- 过滤 / 搜索（前端做，不再打扰设备）-->
				<div class="mt-4 flex flex-wrap items-center gap-3 border-t pt-4">
					<div class="flex items-center gap-1 rounded-md border p-0.5">
						<button
							type="button"
							class={"rounded px-2.5 py-1 text-xs " + (scope === "all" ? "bg-muted font-medium text-foreground" : "text-muted-foreground")}
							onclick={() => (scope = "all")}
						>
							全部
						</button>
						<button
							type="button"
							class={"rounded px-2.5 py-1 text-xs " + (scope === "problems" ? "bg-muted font-medium text-foreground" : "text-muted-foreground")}
							onclick={() => (scope = "problems")}
						>
							只看问题
						</button>
					</div>
					<div class="relative">
						<Search class="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
						<input
							type="text"
							bind:value={query}
							placeholder="搜索内容…"
							class="h-8 w-56 rounded-md border border-input bg-background pr-3 pl-8 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
						/>
					</div>
					<span class="text-xs text-muted-foreground">
						显示 {shown.length} / {rows.length} 行{truncated ? "（更早的日志没有显示）" : ""}
					</span>
					<div class="ml-auto flex items-center gap-2">
						{#if copyErr}<span class="text-xs text-destructive">{copyErr}</span>{/if}
						<Button variant="outline" size="sm" onclick={copyAll} disabled={!rows.length}>
							{#if copied}
								<CircleCheck class="mr-1.5 size-3.5 text-emerald-600" />已复制
							{:else}
								<Copy class="mr-1.5 size-3.5" />复制全文
							{/if}
						</Button>
					</div>
				</div>

				{#if truncated}
					<div class="mt-3 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700">
						<TriangleAlert class="size-3.5 shrink-0" />更早的日志没有显示（这台机器只回传了最近的一段）。
					</div>
				{/if}

				{#if !shown.length}
					<p class="py-10 text-center text-sm text-muted-foreground">
						{rows.length ? "没有符合当前过滤条件的日志。" : "这台机器还没产生日志记录"}
					</p>
				{:else}
					<div class="mt-3 overflow-x-auto">
						<table class="w-full text-sm">
							<thead>
								<tr class="border-b text-left text-xs text-muted-foreground">
									<th class="py-2 pr-3 font-medium whitespace-nowrap">时间</th>
									<th class="py-2 pr-3 font-medium whitespace-nowrap">类别</th>
									<th class="py-2 font-medium">内容</th>
								</tr>
							</thead>
							<tbody>
								{#each shown as r, i (i)}
									<tr class="border-b align-top">
										<td class="py-1.5 pr-3 font-mono text-xs whitespace-nowrap text-muted-foreground">{r.time || "—"}</td>
										<td class={"py-1.5 pr-3 text-xs whitespace-nowrap " + (CAT_CLASS[r.tone] ?? CAT_CLASS.info)}>{r.cat}</td>
										<td class="py-1.5 break-all">{r.content}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</div>
