<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import {
		AppWindow,
		RefreshCw,
		Loader2,
		CircleCheck,
		CircleX,
		CircleSlash,
		ShieldAlert
	} from "@lucide/svelte";
	import { confirmDelete } from "$lib/components/admin/confirm.svelte";
	import type { PageData } from "./$types";

	// 软件管理（Svelte 版 · 2026-09-27）：看某台教室机正在跑哪些软件 + 远程关掉不该开的。
	//
	// 下发通道照 devices 页：sign-task 签名 → stelarith_task 经 send-notification 下发。
	// 结果靠「回执单」拿回来：先 POST /api/console/control/tasks 建单（拿 task_id），
	// 把单号随指令一起下发，再轮询 GET /api/console/control/tasks?task_id= 等设备回报。
	// 服务端在每次查询时顺手做超时判死（5 分钟），所以「无响应」有明确落点，不会一直转圈。
	//
	// 权限由服务端裁决：本页只按 data.can 渲染，绝不自行判断能否关闭。
	let { data }: { data: PageData } = $props();

	type Dev = {
		id: string;
		host: string;
		cls: string;
		online: boolean;
		reported: boolean;
		ageSec: number | null;
	};

	// 列表项结构（与 Rust agent 的 process_list 回执一致）。
	type AppItem = {
		pid: number;
		name: string;
		title: string;
		mem_mb: number;
		/** 受保护原因原值；null = 可安全关闭。界面绝不直接显示这个原值。 */
		protected: string | null;
	};

	type RowState = { kind: "closing" | "ok" | "fail" | "timeout"; msg: string };
	type TaskRow = { state: string; result: string; extra: string; updated_at: string };

	let devices = $state<Dev[]>([]);
	let devLoading = $state(true);
	let devErr = $state("");
	let selId = $state("");

	let apps = $state<AppItem[]>([]);
	let rows = $state<Record<number, RowState>>({});
	let busyPid = $state<number | null>(null);
	// idle=未查询 / loading=等回执 / ready=有数据 / empty=确实没有软件 /
	// offline=设备不在线 / timeout=设备超时未回应 / error=失败（人话 + 重试）
	let listPhase = $state<"idle" | "loading" | "ready" | "empty" | "offline" | "timeout" | "error">("idle");
	let listMsg = $state("");
	let collectedAt = $state("");
	let truncated = $state(false);

	// 轮询世代号：切设备/重新查询时自增，旧轮询自动作废。
	let listGen = 0;
	let stopGen = 0;

	const POLL_MS = 2500; // 下发后隔多久问一次
	const POLL_MAX_MS = 5 * 60 * 1000 + 20 * 1000; // 服务端 5 分钟判死，留一点缓冲

	const selDev = $derived(devices.find((d) => d.id === selId) ?? null);

	// ---- 设备列表（沿用 devices 页的数据源）----
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

	function onDeviceChange() {
		listGen++;
		stopGen++;
		apps = [];
		rows = {};
		truncated = false;
		collectedAt = "";
		listMsg = "";
		busyPid = null;
		listPhase = "idle";
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

	// ---- 下发一条设备指令（判 res.ok，失败把服务端中文 error 原文带回来）----
	async function sendCommand(
		action: string,
		deviceId: string,
		taskId: string,
		extra: Record<string, unknown>
	): Promise<{ error: string }> {
		try {
			// 2026-10-05：走自有设备指令通道（云端 /api/instructions），不再经 CIMS send-notification。
			// 回执单（task_id）照旧：下发参数带上，回执仍走自有 device_tasks。
			const r = await fetch("/api/console/control/device-command", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ uid: deviceId, action, params: { task_id: taskId, ...extra } })
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

	// ---- 解析回执里的软件清单 ----
	function parseList(extraRaw: string): { items: AppItem[]; truncated: boolean; hasItems: boolean } {
		let obj: Record<string, unknown> | null = null;
		try {
			obj = extraRaw ? (JSON.parse(extraRaw) as Record<string, unknown>) : null;
		} catch {
			obj = null;
		}
		if (!obj || typeof obj !== "object") return { items: [], truncated: false, hasItems: false };
		const hasItems = Array.isArray(obj.items);
		const raw = hasItems ? (obj.items as unknown[]) : [];
		const items: AppItem[] = [];
		for (const it of raw) {
			if (!it || typeof it !== "object") continue;
			const o = it as Record<string, unknown>;
			const pid = Number(o.pid);
			if (!Number.isFinite(pid)) continue;
			const mem = Number(o.mem_mb);
			items.push({
				pid,
				name: String(o.name ?? "").trim() || "未知软件",
				title: String(o.title ?? "").trim(),
				mem_mb: Number.isFinite(mem) ? Math.round(mem) : 0,
				protected: o.protected === null || o.protected === undefined ? null : String(o.protected)
			});
		}
		return { items, truncated: obj.truncated === true, hasItems };
	}

	function hhmm(iso: string): string {
		const t = Date.parse(iso);
		const d = new Date(isFinite(t) ? t : Date.now());
		return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
	}

	// 受保护原因 → 界面人话标签（绝不显示原值：原值是给程序看的，老师看不懂）。
	function protectInfo(p: string | null): string {
		if (!p) return "";
		const s = p.trim();
		if (!s) return "";
		if (s.includes("系统")) return "系统进程";
		if (s.includes("安全") || s.includes("杀毒")) return "受保护";
		if (s.includes("集控")) return "集控程序";
		return "受保护";
	}

	async function audit(action: string, target: string, detail: string) {
		try {
			await fetch("/api/console/control/audit", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action, target, detail })
			});
		} catch {
			/* 审计失败不阻断主流程 */
		}
	}

	// ---- 刷新列表：全套「建单 → 下发 → 等回执 → 解析」 ----
	async function refreshList() {
		if (!data.can.view) {
			listPhase = "error";
			listMsg = "当前角色没有「查看运行软件」能力";
			return;
		}
		const d = selDev;
		if (!d) {
			listPhase = "error";
			listMsg = "请先选择一台设备";
			return;
		}
		// 离线时明确说「设备不在线」，不空白、不转圈到底。
		if (!d.reported) {
			listPhase = "offline";
			listMsg = "这台设备还没有接入集控，暂时看不到它上面的软件。";
			return;
		}
		if (!d.online) {
			listPhase = "offline";
			listMsg = "设备不在线";
			return;
		}

		const mine = ++listGen;
		const alive = () => mine === listGen;
		listPhase = "loading";
		listMsg = "";
		apps = [];
		rows = {};
		truncated = false;
		collectedAt = "";

		const { taskId, error: ce } = await createTask(d.id, "process_list");
		if (!alive()) return;
		if (ce) {
			listPhase = "error";
			listMsg = ce;
			return;
		}

		const { error: se } = await sendCommand("process_list", d.id, taskId, {});
		if (!alive()) return;
		if (se) {
			listPhase = "error";
			listMsg = se;
			return;
		}

		const { row, expired, error: pe } = await pollTask(taskId, alive);
		if (!alive()) return;
		if (pe) {
			listPhase = "error";
			listMsg = pe;
			return;
		}
		if (expired || !row || row.state === "timeout") {
			listPhase = "timeout";
			listMsg = "设备 5 分钟未回应";
			return;
		}
		if (row.state === "failed") {
			listPhase = "error";
			listMsg = row.result || "设备未能完成本次查看";
			return;
		}

		const parsed = parseList(row.extra);
		// 回执里根本没带清单字段 → 如实说明，绝不拿假的/空数据冒充「没有软件」。
		if (!parsed.hasItems) {
			listPhase = "error";
			listMsg = "设备回报里没有带上软件清单，当前回执通道拿不到列表数据。";
			return;
		}
		apps = parsed.items;
		truncated = parsed.truncated;
		collectedAt = hhmm(row.updated_at);
		listPhase = apps.length ? "ready" : "empty";
	}

	// ---- 结束一个软件（一次只能关一个）----
	async function stopApp(a: AppItem) {
		if (busyPid !== null) return;
		if (!data.can.stop) return;
		if (protectInfo(a.protected)) return;
		const d = selDev;
		if (!d) return;
		if (!d.online) {
			rows = { ...rows, [a.pid]: { kind: "fail", msg: "设备不在线，无法关闭" } };
			return;
		}

		// 站内统一确认组件（禁用原生 confirm）；文案写清后果。
		const go = await confirmDelete(
			"确认关闭这个软件吗？",
			`将尝试正常关闭「${a.name}」，若 5 秒内未响应会强制结束。未保存的内容可能丢失。`
		);
		if (!go) return;

		const mine = ++stopGen;
		const alive = () => mine === stopGen;
		busyPid = a.pid;
		rows = { ...rows, [a.pid]: { kind: "closing", msg: "正在关闭…" } };

		const { taskId, error: ce } = await createTask(d.id, "process_stop");
		if (!alive()) return;
		if (ce) {
			rows = { ...rows, [a.pid]: { kind: "fail", msg: ce } };
			busyPid = null;
			return;
		}

		const { error: se } = await sendCommand("process_stop", d.id, taskId, { pid: a.pid, name: a.name });
		if (!alive()) return;
		if (se) {
			rows = { ...rows, [a.pid]: { kind: "fail", msg: se } };
			busyPid = null;
			return;
		}

		const { row, expired, error: pe } = await pollTask(taskId, alive);
		if (!alive()) return;

		let st: RowState;
		if (pe) st = { kind: "fail", msg: pe };
		else if (expired || !row || row.state === "timeout") st = { kind: "timeout", msg: "设备 5 分钟未回应" };
		else if (row.state === "done") st = { kind: "ok", msg: `已关闭：${a.name}` };
		else st = { kind: "fail", msg: stopDetail(row) };

		rows = { ...rows, [a.pid]: st };
		busyPid = null;
		if (st.kind === "ok") await audit("apps.stop", d.id, `关闭 ${a.name}`);
	}

	// 失败原因优先取回执里的人话 detail（服务端/agent 给的中文原文）。
	function stopDetail(row: TaskRow): string {
		let extra: Record<string, unknown> | null = null;
		try {
			extra = row.extra ? (JSON.parse(row.extra) as Record<string, unknown>) : null;
		} catch {
			extra = null;
		}
		const cands: string[] = [];
		if (extra) {
			if (typeof extra.detail === "string") cands.push(extra.detail);
			if (typeof extra.error === "string") cands.push(extra.error);
		}
		if (row.result) cands.push(row.result);
		for (const c of cands) if (c && c.trim()) return c.trim();
		return "设备未能完成本次关闭，且没有给出原因。";
	}

	onMount(loadDevices);
	onDestroy(() => {
		listGen++;
		stopGen++;
	});
</script>

<svelte:head>
	<title>软件管理 · 集控面板 | Stelarith</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-6xl p-4 md:p-6">
	<div class="mb-5 flex items-center gap-3">
		<div class="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
			<AppWindow class="size-5" />
		</div>
		<div>
			<h1 class="font-heading text-lg font-semibold">软件管理</h1>
			<p class="text-xs text-muted-foreground">看看某台教室电脑现在开着哪些软件，并可远程关掉不该开的。一次只能关一个；系统进程、安全软件和集控自身的程序不会被关闭。</p>
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
			当前角色没有「查看运行软件」能力，无法使用本页。
		</div>
	{:else}
		<div class="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
			<!-- 设备选择 -->
			<div class="flex flex-wrap items-center gap-3">
				<label class="text-sm font-medium" for="apps-device">设备</label>
				<select
					id="apps-device"
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

			<!-- 工具行 -->
			<div class="mt-4 flex flex-wrap items-center gap-3 border-t pt-4">
				<Button
					variant="outline"
					size="sm"
					onclick={refreshList}
					disabled={listPhase === "loading" || !selDev}
				>
					{#if listPhase === "loading"}
						<Loader2 class="mr-1.5 size-3.5 animate-spin" />
					{:else}
						<RefreshCw class="mr-1.5 size-3.5" />
					{/if}
					刷新列表
				</Button>
				{#if listPhase === "ready" || listPhase === "empty"}
					<span class="text-xs text-muted-foreground">
						共 {apps.length} 个软件{collectedAt ? ` · 采集于 ${collectedAt}` : ""}{truncated ? " · 仅显示前 200 条" : ""}
					</span>
				{/if}
			</div>

			<!-- 内容区 -->
			{#if listPhase === "idle"}
				<p class="py-10 text-center text-sm text-muted-foreground">点上面的「刷新列表」，看看这台设备正在跑哪些软件。</p>
			{:else if listPhase === "loading"}
				<div class="flex items-center justify-center py-10 text-sm text-muted-foreground">
					<Loader2 class="mr-2 size-4 animate-spin" /> 正在读取这台设备上的软件…
				</div>
			{:else if listPhase === "offline"}
				<div class="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">{listMsg || "设备不在线"}</div>
			{:else if listPhase === "timeout"}
				<div class="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
					{listMsg}。可以点「刷新列表」再试一次。
				</div>
			{:else if listPhase === "error"}
				<div class="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
					<span>{listMsg}</span>
					<Button variant="outline" size="sm" onclick={refreshList}>重试</Button>
				</div>
			{:else if listPhase === "empty"}
				<p class="py-10 text-center text-sm text-muted-foreground">这台设备当前没有检测到正在运行的软件。</p>
			{:else}
				<div class="mt-4 overflow-x-auto">
					<table class="w-full text-sm">
						<thead>
							<tr class="border-b text-left text-xs text-muted-foreground">
								<th class="py-2 pr-3 font-medium">名称</th>
								<th class="py-2 pr-3 font-medium">窗口标题</th>
								<th class="py-2 pr-3 font-medium">内存</th>
								<th class="py-2 font-medium">操作</th>
							</tr>
						</thead>
						<tbody>
							<!-- ⚠️ 键必须是「pid + 行号」，绝不能只用 pid：本机 agent 的 process_list
							     是**按窗口**返回的 —— 同一个进程开多个窗口就会有多行同 pid
							     （实测 msedge.exe pid 21164 一次返回 3 行，窗口标题各不相同）。
							     只用 pid 作键 → Svelte 抛 `each_key_duplicate` → 整个 tbody 渲染失败，
							     页面永久停在「正在读取这台设备上的软件…」，列表永远出不来
							     （2026-10-01 在 /admin/console/apps 用 CDP 实捕异常坐实）。 -->
							{#each apps as a, i (a.pid + "#" + i)}
								{@const prot = protectInfo(a.protected)}
								{@const st = rows[a.pid]}
								<tr class={"border-b " + (prot ? "opacity-50" : "")}>
									<td class="py-2 pr-3">
										<span class="font-medium">{a.name}</span>
									</td>
									<td class="py-2 pr-3 text-muted-foreground">{a.title || "—"}</td>
									<td class="py-2 pr-3 text-muted-foreground">{a.mem_mb > 0 ? `${a.mem_mb} MB` : "—"}</td>
									<td class="py-2 pr-3">
										{#if prot}
											<span class="inline-flex items-center gap-1 text-xs text-muted-foreground">
												<ShieldAlert class="size-3.5" />{prot}
											</span>
										{:else if st?.kind === "closing"}
											<Button size="sm" variant="outline" class="h-7 px-2 text-xs" disabled>
												<Loader2 class="mr-1 size-3 animate-spin" />正在关闭…
											</Button>
										{:else if st?.kind === "ok"}
											<span class="inline-flex items-center gap-1 text-xs text-emerald-600">
												<CircleCheck class="size-3.5" />{st.msg}
											</span>
										{:else if st?.kind === "fail"}
											<span class="inline-flex items-center gap-1 text-xs text-destructive">
												<CircleX class="size-3.5" />{st.msg}
											</span>
										{:else if st?.kind === "timeout"}
											<span class="inline-flex items-center gap-1 text-xs text-muted-foreground">
												<CircleSlash class="size-3.5" />{st.msg}
											</span>
										{:else if !data.can.stop}
											<Button size="sm" variant="outline" class="h-7 px-2 text-xs" disabled>无权限</Button>
										{:else}
											<Button
												size="sm"
												variant="destructive"
												class="h-7 px-2 text-xs"
												onclick={() => stopApp(a)}
												disabled={busyPid !== null || !selDev?.online}
											>
												结束
											</Button>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
					<p class="mt-2 text-xs text-muted-foreground">
						灰显的软件不会被关闭：系统进程、安全软件、集控自身的组成程序都属于受保护范围。
					</p>
				</div>
			{/if}
		</div>
	{/if}
</div>
