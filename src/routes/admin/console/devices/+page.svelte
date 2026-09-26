<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { toast } from "svelte-sonner";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "$lib/components/ui/card/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { Select, SelectContent, SelectItem, SelectTrigger } from "$lib/components/ui/select/index.js";
	import { MonitorSmartphone, RefreshCw, Lock, Camera, Power, Clock, Search, Loader2, KeyRound, Copy, Trash2, Plus, Volume2 } from "@lucide/svelte";
	import type { PageData } from "./$types";

	// 设备控制（Svelte 版 · 2026-09-26 从原生面板迁移）。
	// 数据走 /api/console/cims 服务端代理（凭据在服务端、权限在代理过滤）；
	// 写操作经 sign-task 签名后下发 stelarith_task。
	let { data }: { data: PageData } = $props();

	type Dev = {
		id: string; host: string; hostKnown: boolean; online: boolean; reported: boolean;
		ip: string; ver: string; classId: string; className: string; stateLabel: string; stateKind: string;
		last: string; modules: Record<string, boolean>; plugins: unknown[]; extra: Record<string, unknown>;
	};
	type DevMap = { devices: Record<string, string>; classes: { class_id: string; name: string }[] };

	let devices = $state<Dev[]>([]);
	let fresh = $state(90);
	let loading = $state(true);
	let error = $state("");
	let query = $state("");
	let grouped = $state(true);
	let viewMode = $state<"grid" | "table">("grid");
	let shots = $state<Record<string, string>>({}); // deviceId -> dataURL
	let shotBusy = $state(false);
	let devMap = $state<DevMap>({ devices: {}, classes: [] });

	async function load() {
		loading = true; error = "";
		try {
			const [sr, mr] = await Promise.all([
				fetch("/api/console/cims/class/device-status"),
				fetch("/api/console/cims/class/device-map"),
			]);
			const s = await sr.json();
			const m = await mr.json();
			fresh = Number(s.fresh_seconds || 90) || 90;
			devices = Array.isArray(s.devices) ? s.devices.map(norm) : [];
			devMap = m && typeof m === "object" ? m : { devices: {}, classes: [] };
		} catch (e) {
			error = (e as Error)?.message || "设备状态加载失败";
		} finally {
			loading = false;
		}
		loadActCodes(); // 接入码列表（非阻塞，无权限时静默）
	}

	function norm(d: Record<string, unknown>): Dev {
		const online = !!d.online, reported = !!d.reported;
		return {
			id: String(d.client_id ?? ""),
			host: String(d.host ?? ""), hostKnown: !!d.host,
			online, reported,
			ip: String(d.ip ?? ""), ver: String(d.version ?? "—"),
			classId: String(d.class_id ?? ""), className: String(d.class_name ?? ""),
			last: reported ? ago(Number(d.age_seconds)) : "从未上报",
			modules: (d.modules && typeof d.modules === "object" ? d.modules : {}) as Record<string, boolean>,
			plugins: Array.isArray(d.plugins) ? d.plugins : [],
			extra: (d.extra && typeof d.extra === "object" ? d.extra : {}) as Record<string, unknown>,
			stateLabel: !reported ? "尚未接入" : online ? "在线" : "离线",
			stateKind: !reported ? "warn" : online ? "ok" : "err",
		};
	}

	function ago(sec: number | null | undefined): string {
		if (typeof sec !== "number" || !isFinite(sec)) return "从未上报";
		if (sec < 60) return sec + " 秒前";
		if (sec < 3600) return Math.floor(sec / 60) + " 分钟前";
		if (sec < 86400) return Math.floor(sec / 3600) + " 小时前";
		return Math.floor(sec / 86400) + " 天前";
	}

	function classOf(d: Dev): { label: string; bound: boolean } {
		if (d.className) return { label: d.className, bound: true };
		if (d.classId) return { label: d.classId, bound: true };
		const cid = devMap.devices?.[d.id];
		if (cid) {
			const c = (devMap.classes || []).find((x) => x.class_id === cid);
			return { label: c?.name || cid, bound: true };
		}
		return { label: "未绑定", bound: false };
	}

	// 卡片预览截图：每 5 分钟自动刷新；点「刷新截图」立即拉。
	async function refreshShots(force = false) {
		if (shotBusy) return;
		shotBusy = true;
		const targets = filtered.filter((d) => d.id);
		for (const d of targets) {
			if (!force && shots[d.id]) continue;
			try {
				const cap = await (await fetch(`/api/console/ext/captures?uid=${encodeURIComponent(d.id)}`)).json();
				if (cap?.image_base64) shots[d.id] = `data:image/png;base64,${cap.image_base64}`;
			} catch { /* 单台失败跳过 */ }
		}
		shotBusy = false;
	}
	let shotTimer: ReturnType<typeof setInterval> | null = null;
	onMount(() => {
		load();
		refreshShots();
		shotTimer = setInterval(() => refreshShots(), 300_000); // 5 分钟
	});
	onDestroy(() => { if (shotTimer) clearInterval(shotTimer); });


	// 筛选 + 分组计算（与原生版同口径）
	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return devices;
		return devices.filter((d) => {
			const c = classOf(d);
			return [d.id, d.host, d.ip, d.ver, d.className, d.classId, c.label]
				.filter(Boolean).join(" ").toLowerCase().includes(q);
		});
	});

	const groups = $derived.by(() => {
		const g = new Map<string, Dev[]>();
		for (const d of filtered) {
			const cls = classOf(d).label;
			if (!g.has(cls)) g.set(cls, []);
			g.get(cls)!.push(d);
		}
		const names = [...g.keys()].sort((a, b) => {
			if (a === "未绑定") return 1;
			if (b === "未绑定") return -1;
			return a.localeCompare(b, "zh-Hans-CN");
		});
		return names.map((n) => ({ name: n, list: g.get(n)! }));
	});

	// ---- 操作 ----
	async function sign(action: string, ts: number): Promise<string> {
		try {
			const r = await fetch("/api/console/sign-task", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action, ts }),
				credentials: "same-origin",
			});
			const j = await r.json();
			if (r.ok && j?.ok && j.token) return j.token;
		} catch {
			/* fall through to placeholder */
		}
		return String(Date.now());
	}

	async function deviceAction(d: Dev, act: string) {
		if (!data.can.control) { toast.error("无权限：设备控制"); return; }
		if (act === "shutdown" && !confirm(`确认关机设备 ${d.id} 吗？\n关机后需人工到教室开机，请谨慎操作。`)) return;
		try {
			const native = { restart: "restart", refresh: "update-data" } as Record<string, string>;
			if (native[act]) {
				await fetch(`/api/console/cims/account/${data.accountId}/client/${d.id}/command/${native[act]}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
			} else {
				// lock/screenshot/reboot/shutdown → stelarith_task（插件/代理执行）
				const ts = Math.floor(Date.now() / 1000);
				const token = await sign(act, ts);
				const payload = { stelarith_task: { action: act, token, scope: "device", ts } };
				await fetch(`/api/console/cims/account/${data.accountId}/client/${d.id}/command/send-notification`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ MessageContent: JSON.stringify(payload) }),
				});
			}
			await audit("device." + act, d.id, "下发设备指令");
			toast.success(`已下发指令：${act} → ${d.id}`);
			if (act === "screenshot") waitForCapture(d);
		} catch (e) {
			toast.error("下发失败：" + ((e as Error)?.message || e));
		}
	}

	async function audit(action: string, target: string, detail: string) {
		try {
			await fetch("/api/console/ext/audit", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action, target, detail }),
			});
		} catch {
			/* 审计失败不阻断主流程 */
		}
	}

	let captureBusy = $state(false);
	async function waitForCapture(d: Dev) {
		captureBusy = true;
		const keys = [d.id, d.host && d.host !== d.id ? d.host : null].filter(Boolean);
		for (let i = 0; i < 10; i++) {
			await new Promise((r) => setTimeout(r, 2000));
			for (const k of keys) {
				try {
					const cap = await (await fetch(`/api/console/ext/captures?uid=${encodeURIComponent(String(k))}`)).json();
					if (cap?.image_base64) {
						window.open(`data:image/png;base64,${cap.image_base64}`);
						captureBusy = false;
						return;
					}
				} catch {
					/* 轮询失败继续 */
				}
			}
		}
		captureBusy = false;
		toast.warning(`等待截图回传超时（${d.id} 未回报图片）`);
	}

	// 绑定班级
	const selClasses = $state<Record<string, string>>({});
	async function assign(d: Dev) {
		const cid = selClasses[d.id] || "";
		if (!cid) { toast.error("请先选择班级"); return; }
		try {
			const r = await fetch(`/api/console/cims/class/device/assign?class_id=${encodeURIComponent(cid)}&client_id=${encodeURIComponent(d.id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
			const j = await r.json();
			if (!r.ok && j?.error) throw new Error(j.error);
			await audit("device.assign", d.id, "绑定到 " + cid);
			toast.success("已绑定：" + cid);
			load();
		} catch (e) {
			toast.error("绑定失败：" + ((e as Error)?.message || e));
		}
	}

	async function unassign(d: Dev) {
		try {
			const r = await fetch(`/api/console/cims/class/device/unassign?client_id=${encodeURIComponent(d.id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
			const j = await r.json();
			if (!r.ok && j?.error) throw new Error(j.error);
			await audit("device.unassign", d.id, "解除班级绑定");
			toast.success("已解绑：" + d.id);
			load();
		} catch (e) {
			toast.error("解绑失败：" + ((e as Error)?.message || e));
		}
	}

	const stats = $derived.by(() => {
		const online = devices.filter((d) => d.online).length;
		const unbound = devices.filter((d) => !classOf(d).bound).length;
		const never = devices.filter((d) => !d.reported).length;
		return { online, unbound, never, total: devices.length };
	});
	// ── 设备接入码（统一接入，2026-09-26）──────────────────────────────
	type ActCode = { code: string; classId: string; className: string; createdAt: string; expiresAt: string; used: boolean; usedBy?: string };
	let actCodes = $state<ActCode[]>([]);
	let actClass = $state("class_08");
	let actClassLabel = $state("星璃演示班");
	let actHours = $state(48);
	let actGenerating = $state(false);

	async function loadActCodes() {
		try {
			const r = await fetch("/api/console/ext/device-activate");
			const j = await r.json();
			actCodes = j.codes ?? [];
		} catch { /* 静默：无权限时不打扰 */ }
	}

	async function genActCode() {
		actGenerating = true;
		try {
			const r = await fetch("/api/console/ext/device-activate", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ classId: actClass, className: actClassLabel, hours: actHours })
			});
			const j = await r.json();
			if (!r.ok) { toast.error(j.error ?? "生成失败"); return; }
			toast.success("接入码已生成：" + (j.code?.code ?? ""));
			await loadActCodes();
		} catch { toast.error("生成失败"); } finally { actGenerating = false; }
	}

	async function revokeAct(code: string) {
		try {
			const r = await fetch("/api/console/ext/device-activate?code=" + encodeURIComponent(code), { method: "DELETE" });
			if (r.ok) { toast.success("已作废 " + code); await loadActCodes(); }
			else toast.error("作废失败");
		} catch { toast.error("作废失败"); }
	}

	async function copyAct(code: string) {
		try { await navigator.clipboard.writeText(code); toast.success("已复制"); } catch { toast.error("复制失败"); }
	}

</script>
<svelte:head>
	<title>设备控制 · 集控面板 | Stelarith</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-6xl p-4 md:p-6">
	<div class="mb-5 flex items-center gap-3">
		<div class="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
			<MonitorSmartphone class="size-5" />
		</div>
		<div>
			<h1 class="font-heading text-lg font-semibold">设备控制</h1>
			<p class="text-xs text-muted-foreground">查看并控制全校教室电脑：截图预览、锁屏、关机、远控、调音量，5 分钟自动刷新。</p>
			<div class="mt-2 rounded-lg border bg-muted/40 p-3 text-xs">
				<p class="font-medium text-foreground">使用说明</p>
				<ol class="mt-1 list-decimal pl-4 text-muted-foreground">
					<li>卡片显示每台设备的桌面预览（5 分钟刷新，点「截图」立即拍摄）</li>
					<li>「远控」实时操作该电脑（会话用完即关，每次操作留记录）</li>
					<li>换班：先解绑再绑到新班，不会抢走别的班</li>
				</ol>
				<!-- 图片占位：后续接入设备截图示例图 -->
				<div class="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground/70">
					<span class="inline-block size-3 rounded bg-primary/20" />
					图片占位：教室端界面截图示意
				</div>
			</div>
		</div>
	</div>

	{#if loading}
		<div class="flex items-center justify-center py-16 text-muted-foreground"><Loader2 class="mr-2 size-4 animate-spin" /> 正在加载设备…</div>
	{:else if error}
		<div class="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">设备状态加载失败：{error}</div>
	{:else}
		<div class="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
			<p class="text-xs text-muted-foreground">在线 {stats.online} / 共 {stats.total} 台{stats.never ? `，其中 ${stats.never} 台从未上报（还没接入集控）` : ""}。状态取自设备真实心跳：超过 {fresh} 秒没有心跳即判离线。</p>
			{#if stats.unbound}
				<p class="mt-1 text-xs text-amber-600">⚠ 有 {stats.unbound} 台设备尚未绑定班级，定向广播不会覆盖到它们。</p>
			{/if}

			<div class="mt-3 flex flex-wrap items-center gap-2">
				<div class="relative flex-1 min-w-[240px]">
					<Search class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
					<input type="search" bind:value={query} placeholder="搜索 班级 / 设备名 / 设备号 / IP / 版本…" class="h-9 w-full rounded-lg border border-input bg-transparent pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50" />
				</div>
				<Button variant="outline" size="sm" onclick={() => (grouped = !grouped)}>{grouped ? "改为平铺" : "按班级分组"}</Button>

				<Button variant="outline" size="sm" onclick={load}><RefreshCw class="mr-1.5 size-3.5" /> 刷新</Button>
			</div>

			{#if !filtered.length}
				<p class="py-10 text-center text-sm text-muted-foreground">该账户下暂无已注册设备</p>
			{:else}
					<div class="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
						{#each filtered as d (d.id)}
							<div class="rounded-xl border bg-card p-4 shadow-sm transition hover:shadow-md">
								<div class="flex items-start justify-between gap-2">
									<div class="min-w-0">
										<div class="truncate font-semibold">{d.hostKnown ? d.host : d.id}</div>
										<div class="truncate text-xs text-muted-foreground">{d.id}</div>
									</div>
									<span class={"inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs " + (d.stateKind === "ok" ? "bg-emerald-500/15 text-emerald-600" : d.stateKind === "err" ? "bg-red-500/15 text-red-500" : "bg-muted text-muted-foreground")}>{d.stateLabel}</span>
								</div>
								{#if shots[d.id]}
									<div class="mt-3 overflow-hidden rounded-lg border">
										<img src={shots[d.id]} alt="桌面截图" class="aspect-video w-full object-cover" loading="lazy" />
									</div>
								{:else}
									<div class="mt-3 flex aspect-video items-center justify-center rounded-lg border bg-muted/30 text-xs text-muted-foreground">暂无截图 · 点下方按钮获取</div>
								{/if}
								<div class="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
									<Badge variant={classOf(d).bound ? "secondary" : "outline"}>{classOf(d).label}</Badge>
									{#if d.ip}<span>{d.ip}</span>{/if}
									{#if d.ver}<span>v{d.ver}</span>{/if}
									<span>{d.last}</span>
								</div>
								<div class="mt-3 flex flex-wrap gap-2">
									{#if data.can.remote}
										<Button size="sm" variant="outline" class="h-7 px-2 text-xs" onclick={() => deviceAction(d, "remote_control_start")}><MonitorSmartphone class="mr-1 size-3" />远控</Button>
									{/if}
									<Button size="sm" variant="outline" class="h-7 px-2 text-xs" onclick={() => deviceAction(d, "screenshot")}><Camera class="mr-1 size-3" />截图</Button>
										<Button size="sm" variant="outline" class="h-7 px-2 text-xs" onclick={() => setVolume(d)}><Volume2 class="mr-1 size-3" />音量</Button>
										<Button size="sm" variant="outline" class="h-7 px-2 text-xs" onclick={() => sendFile(d)}><MonitorSmartphone class="mr-1 size-3" />发文件</Button>
									{#if data.can.control}
										<Button size="sm" variant="outline" class="h-7 px-2 text-xs" onclick={() => deviceAction(d, "lock")}><Lock class="mr-1 size-3" />锁屏</Button>
										<Button size="sm" variant="destructive" class="h-7 px-2 text-xs" onclick={() => deviceAction(d, "shutdown")}><Power class="mr-1 size-3" />关机</Button>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				
			{/if}
		</div>
				{/if}
</div>

{#snippet devRow(d: Dev)}
	<tr class="border-b">
		<td class="py-2 pr-3">
			<div class="font-medium">
				{#if d.hostKnown}
					{d.host}
				{:else}
					<span class="text-muted-foreground">（尚未上报主机名）</span>
				{/if}
			</div>
			<div class="text-xs text-muted-foreground">{d.id}</div>
		</td>
		<td class="py-2 pr-3"><Badge variant={classOf(d).bound ? "secondary" : "outline"}>{classOf(d).label}</Badge></td>
		<td class="py-2 pr-3 text-muted-foreground">{d.ip || "—"}</td>
		<td class="py-2 pr-3 text-muted-foreground">{d.ver}</td>
		<td class="py-2 pr-3 text-muted-foreground">{d.last}</td>
		<td class="py-2 pr-3">
			<span class={"inline-flex items-center rounded-full px-2 py-0.5 text-xs " + (d.stateKind === "ok" ? "bg-emerald-500/15 text-emerald-600" : d.stateKind === "err" ? "bg-red-500/15 text-red-600" : "bg-amber-500/15 text-amber-600")}>{d.stateLabel}</span>
		</td>
		<td class="py-2 pr-3">
			<div class="flex items-center gap-1.5">
				<select bind:value={selClasses[d.id]} class="h-8 max-w-[150px] rounded-md border border-input bg-transparent px-2 text-xs outline-none">
					<option value="">— 选择班级 —</option>
					{#each devMap.classes || [] as c (c.class_id)}
						<option value={c.class_id}>{c.name}</option>
					{/each}
				</select>
				{#if data.can.manage}
					<Button size="sm" variant="outline" class="h-7 px-2 text-xs" onclick={() => assign(d)} disabled={!selClasses[d.id]}>{classOf(d).bound ? "改绑" : "绑定"}</Button>
					<Button size="sm" variant="ghost" class="h-7 px-2 text-xs" onclick={() => unassign(d)} disabled={!classOf(d).bound}>解绑</Button>
				{/if}
			</div>
		</td>
		<td class="py-2">
			<div class="flex flex-wrap gap-1.5">
				{#if data.can.control}
					<Button size="sm" variant="outline" class="h-7 px-2 text-xs" onclick={() => deviceAction(d, "restart")} disabled={!d.online}>重启</Button>
					<Button size="sm" variant="outline" class="h-7 px-2 text-xs" onclick={() => deviceAction(d, "refresh")} disabled={!d.online}>刷新</Button>
					<Button size="sm" variant="outline" class="h-7 px-2 text-xs" onclick={() => deviceAction(d, "lock")} disabled={!d.online}><Lock class="mr-1 size-3" />锁屏</Button>
					<Button size="sm" variant="outline" class="h-7 px-2 text-xs" onclick={() => deviceAction(d, "screenshot")} disabled={!d.online}><Camera class="mr-1 size-3" />截图</Button>
					<Button size="sm" variant="destructive" class="h-7 px-2 text-xs" onclick={() => deviceAction(d, "shutdown")} disabled={!d.online}><Power class="mr-1 size-3" />关机</Button>
				{/if}
			</div>
		</td>
	</tr>
{/snippet}
	<!-- 设备接入码管理 -->
	<Card class="mt-4">
		<CardHeader>
			<CardTitle class="flex items-center gap-2"><KeyRound class="size-4" /> 设备接入码</CardTitle>
			<CardDescription>生成班级接入码，教室端 agent 首次安装输入激活码自动拉取配置（uid/密钥/站点），替代手动写配置</CardDescription>
		</CardHeader>
		<CardContent class="space-y-4">
			<div class="flex items-end gap-3">
				<div class="grid gap-1.5">
					<Label>班级 ID</Label>
					<Input bind:value={actClass} placeholder="class_08" class="w-40" />
				</div>
				<div class="grid gap-1.5">
					<Label>班级名</Label>
					<Input bind:value={actClassLabel} placeholder="星璃演示班" class="w-44" />
				</div>
				<div class="grid gap-1.5">
					<Label>有效期(小时)</Label>
					<Input bind:value={actHours} type="number" class="w-24" />
				</div>
				<Button onclick={genActCode} disabled={actGenerating}>
					{#if actGenerating}<Loader2 class="size-4 animate-spin" />{:else}<Plus class="size-4" />{/if}
					生成接入码
				</Button>
			</div>
			{#if actCodes.length}
				<div class="space-y-2">
					{#each actCodes as c}
						<div class="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
							<span class="font-mono font-semibold">{c.code}</span>
							<Badge variant="outline">{c.className}</Badge>
							{#if c.used}
								<Badge variant="secondary">已用 · {c.usedBy ?? ""}</Badge>
							{:else if new Date(c.expiresAt) < new Date()}
								<Badge variant="destructive">已过期</Badge>
							{:else}
								<Badge variant="default">有效</Badge>
							{/if}
							<span class="ml-auto flex gap-1">
								<Button size="sm" variant="ghost" class="h-6 px-2" onclick={() => copyAct(c.code)}><Copy class="size-3" /></Button>
								<Button size="sm" variant="ghost" class="h-6 px-2" onclick={() => revokeAct(c.code)}><Trash2 class="size-3" /></Button>
							</span>
						</div>
					{/each}
				</div>
			{:else}
				<p class="text-sm text-muted-foreground">暂无接入码 —— 生成一个发给教室端安装时输入。</p>
			{/if}
		</CardContent>
	</Card>

