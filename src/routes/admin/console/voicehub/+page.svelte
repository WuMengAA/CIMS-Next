<script lang="ts">
	import { onMount } from "svelte";
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "$lib/components/ui/card/index.js";
	import { Button } from "$lib/components/ui/button/index.js";
	import {
		ArrowLeft,
		Music,
		RefreshCw,
		Loader2,
		Info,
		AlertTriangle,
		Save,
		Pencil,
		ExternalLink
	} from "@lucide/svelte";

	// ── 校园点歌（VoiceHub）真页 ────────────────────────────────────────────
	// 从旧静态面板 static/console/app.js 的 `views.voicehub` 迁移（2026-10-02）。
	//
	// 主体是**内嵌点歌站 iframe**：host + "/?embed=1"（拼 embed=1 供点歌站自行收敛
	// 外壳，未实现也无副作用）。队列只是旁路信息 —— **队列取不到不阻断内嵌**，
	// 点歌站本身才是主功能区。
	//
	// 配置读取/保存位置与旧面板**完全一致**：浏览器 localStorage。
	//   旧面板 api.js 的 FIELDS.voicehubHost.pkey = "cims_vhub_host"（写入时去尾斜杠），
	//   API Key 为 "cims_vhub_key"。沿用同一键名，旧面板填过的地址在本页直接可用。
	// 面板**没有**对应 voicehubHost 的服务端设置端点（/api/console/control/settings 的
	// 白名单里没有它），所以这里不发明新端点，照旧走 localStorage。
	const LS_HOST = "cims_vhub_host";
	const LS_KEY = "cims_vhub_key";

	// ⚠️ sandbox 取舍（「防跳转 + 防关闭」的技术落点）—— 逐字照抄旧实现，不自行增删：
	//   allow-scripts       —— 页面要能跑
	//   allow-same-origin   —— 保留自身 origin，否则 cookie/存储全废，点歌站会退化成未登录
	//   allow-forms         —— 点歌站有搜索/提交表单
	//   allow-modals        —— 站点可能用 alert 提示「已提交」，不加会静默失败
	// **故意不给**：
	//   allow-top-navigation(-by-user-activation) —— 否则站内点链接会把整个集控面板顶掉
	//   allow-popups                              —— 否则能弹新窗口跳出面板；同时 window.close() 也失效
	// 即：它只能在自己那一格画框里活动，既跳不出去，也关不掉自己。
	const SANDBOX = "allow-scripts allow-same-origin allow-forms allow-modals";

	type NowSong = { title: string; artist: string; by: string; at: string };
	type QueueSong = { id: string; title: string; artist: string; by: string; votes: number; at: string };
	type QueueState = "no-host" | "loading" | "ok" | "error";

	let host = $state("");
	let hostInput = $state("");
	let editing = $state(false);
	let savedHint = $state("");

	let queueState = $state<QueueState>("no-host");
	let queueError = $state("");
	let now = $state<NowSong | null>(null);
	let queue = $state<QueueSong[]>([]);

	const embedUrl = $derived(host ? host + "/?embed=1" : "");
	// 同源告警：点歌站与面板在同一 origin 下时，iframe 隔离效果打折（照旧实现的判断）。
	const sameOriginWarn = $derived(
		!!host &&
			typeof window !== "undefined" &&
			!!window.location.origin &&
			host.startsWith(window.location.origin)
	);

	onMount(() => {
		host = (localStorage.getItem(LS_HOST) || "").replace(/\/+$/, "");
		hostInput = host;
		loadQueue();
	});

	/** 取「正在播放」（最近已播一首）与「待播队列」（未播、按提交时间升序）。 */
	async function loadQueue() {
		if (!host) {
			queueState = "no-host";
			now = null;
			queue = [];
			return;
		}
		queueState = "loading";
		queueError = "";
		const key = localStorage.getItem(LS_KEY) || "";
		try {
			const [nowRes, qRes] = await Promise.all([
				fetch(host + "/api/open/songs?played=true&sortBy=playedAt&sortOrder=desc&limit=1", {
					headers: { "x-api-key": key }
				}),
				fetch(host + "/api/open/songs?played=false&sortBy=createdAt&sortOrder=asc&limit=10", {
					headers: { "x-api-key": key }
				})
			]);
			if (!nowRes.ok || !qRes.ok) {
				// 401 单独说清：多半是 API Key 没配/失效，而不是「队列真的空」。
				const status = nowRes.ok ? qRes.status : nowRes.status;
				throw new Error(status === 401 ? "点歌站 API Key 无效或未授权（HTTP 401）" : "点歌站 HTTP " + status);
			}
			const nowJ = (await nowRes.json()) as { data?: { songs?: Record<string, unknown>[] } };
			const qJ = (await qRes.json()) as { data?: { songs?: Record<string, unknown>[] } };
			const n = nowJ?.data?.songs?.[0];
			now = n
				? {
						title: String(n.title ?? ""),
						artist: String(n.artist ?? ""),
						by: String(n.requester ?? ""),
						at: String(n.playedAtFormatted ?? "")
					}
				: null;
			queue = (qJ?.data?.songs ?? []).map((s) => ({
				id: String(s.id ?? ""),
				title: String(s.title ?? ""),
				artist: String(s.artist ?? ""),
				by: String(s.requester ?? ""),
				votes: Number(s.voteCount ?? 0),
				at: String(s.requestedAt ?? "")
			}));
			queueState = "ok";
		} catch (e) {
			// 诚实 UI：取不到就保留出错原因，**不伪装成空队列**、也不回落到演示数据。
			now = null;
			queue = [];
			queueState = "error";
			queueError = (e as Error)?.message || String(e);
		}
	}

	function startEdit() {
		hostInput = host;
		savedHint = "";
		editing = true;
	}

	function saveHost() {
		const v = (hostInput || "").trim().replace(/\/+$/, "");
		try {
			localStorage.setItem(LS_HOST, v);
		} catch {
			/* 隐私模式 / 配额满：写失败不阻断，只是换电脑不生效 */
		}
		host = v;
		editing = false;
		savedHint = v ? "地址已保存" : "已清空地址";
		loadQueue();
	}
</script>

<svelte:head>
	<title>校园点歌 · 集控面板 | Stelarith</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
	<!-- 回概览 -->
	<a
		href="/admin/console"
		class="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
	>
		<ArrowLeft class="size-4" /> 回概览
	</a>

	<!-- 页头 -->
	<div class="flex items-center gap-3">
		<div class="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
			<Music class="size-5" />
		</div>
		<div>
			<h1 class="font-heading text-lg font-semibold">校园点歌</h1>
			<p class="text-xs text-muted-foreground">
				内嵌点歌站，管理员可在下方直接取用；点歌站只能在自己的框内运行，跳不出去也关不掉自己。
			</p>
		</div>
	</div>

	<!-- ① 内嵌点歌站 -->
	<Card>
		<CardHeader class="flex-row items-center justify-between gap-2 space-y-0">
			<div>
				<CardTitle class="flex items-center gap-2"><Music class="size-4" /> 点歌站</CardTitle>
				<CardDescription>
					{#if host}已内嵌：{host}{:else}未配置点歌站地址{/if}
				</CardDescription>
			</div>
			<div class="flex flex-wrap items-center gap-2">
				{#if host && !editing}
					<Button variant="outline" size="sm" onclick={startEdit}>
						<Pencil class="mr-1.5 size-3.5" /> 修改地址
					</Button>
				{/if}
				<Button variant="outline" size="sm" onclick={loadQueue} disabled={!host || queueState === "loading"}>
					{#if queueState === "loading"}<Loader2 class="mr-1.5 size-3.5 animate-spin" />{:else}<RefreshCw class="mr-1.5 size-3.5" />{/if}
					刷新队列
				</Button>
			</div>
		</CardHeader>
		<CardContent class="space-y-3">
			{#if !host}
				<!-- 未配置：显式提示 + 就地填写 -->
				<div
					class="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400"
				>
					<AlertTriangle class="mt-0.5 size-4 shrink-0" />
					<p>点歌站未配置。填写地址后这里会内嵌显示，不会跳出集控面板。</p>
				</div>
			{/if}

			{#if !host || editing}
				<div class="rounded-lg border border-border/60 bg-muted/40 p-3">
					<div class="flex flex-wrap items-center gap-2">
						<label class="text-xs font-medium text-muted-foreground" for="vh-host">点歌站地址</label>
						<input
							id="vh-host"
							type="url"
							bind:value={hostInput}
							placeholder="https://voicehub.example.edu"
							class="h-9 min-w-[260px] flex-1 rounded-md border border-border/60 bg-background px-3 text-sm outline-none focus-visible:border-primary/50"
						/>
						<Button size="sm" onclick={saveHost}>
							<Save class="mr-1.5 size-3.5" /> 保存
						</Button>
						{#if host}
							<Button variant="ghost" size="sm" onclick={() => (editing = false)}>取消</Button>
						{/if}
					</div>
					<p class="mt-2 text-xs text-muted-foreground">
						保存位置：<b>本机浏览器</b>的 localStorage（键 <code>cims_vhub_host</code>），与旧版面板共用同一键。
						它是「每台电脑各存一份」，换电脑 / 换浏览器需重新填写；尾斜杠会自动去掉。
						<!--
							API Key（键 cims_vhub_key）用于拉取队列与点歌，需在点歌站后台生成具备
							songs:read / songs:request 权限的 Key；它仍由旧版面板的「连接设置」维护。
						-->
					</p>
					{#if savedHint}
						<p class="mt-1 text-xs text-emerald-600 dark:text-emerald-400">{savedHint}</p>
					{/if}
				</div>
			{:else}
				<!-- 已配置：内嵌点歌站（主功能区，给足高度） -->
				<iframe
					class="h-[68vh] min-h-[520px] w-full rounded-xl border border-border/60 bg-background"
					src={embedUrl}
					sandbox={SANDBOX}
					referrerpolicy="no-referrer"
					title="校园点歌站"
				></iframe>
				<p class="text-xs text-muted-foreground">
					已限制：页面<b>无法跳转或替换集控面板</b>、<b>无法弹出新窗口</b>、<b>无法自行关闭</b>；
					点歌站仅在自己这一格内运行（sandbox：<code>{SANDBOX}</code>）。
				</p>
				{#if sameOriginWarn}
					<div
						class="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400"
					>
						<AlertTriangle class="mt-0.5 size-3.5 shrink-0" />
						<p>点歌站和本面板在同一个网址下，隔离效果会打折。建议把点歌站放到独立的域名或端口。</p>
					</div>
				{/if}
				<p class="text-xs text-muted-foreground">
					需要用别的地址时，点上方的「修改地址」；地址保存在本机浏览器，见说明。
				</p>
			{/if}
		</CardContent>
	</Card>

	<!-- ② 屏幕同步：正在播放 + 待播队列 -->
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2"><RefreshCw class="size-4" /> 屏幕同步</CardTitle>
			<CardDescription>
				数据来自点歌站公开 API，与「推送到本班屏幕（CIMS 资源 <code>songboard</code>）」同源。队列取不到不影响上方内嵌点歌站。
			</CardDescription>
		</CardHeader>
		<CardContent class="space-y-4">
			{#if queueState === "no-host"}
				<div class="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
					<Info class="mt-0.5 size-3.5 shrink-0" />
					<p>未配置点歌站地址，无法拉取队列。</p>
				</div>
			{:else if queueState === "loading"}
				<div class="flex items-center justify-center py-8 text-sm text-muted-foreground">
					<Loader2 class="mr-2 size-4 animate-spin" /> 正在读取点歌队列…
				</div>
			{:else if queueState === "error"}
				<!-- 诚实 UI：取不到就如实报原因，**不伪装成空队列** -->
				<div class="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
					<AlertTriangle class="mt-0.5 size-4 shrink-0 text-destructive" />
					<div>
						<p class="font-medium text-destructive">点歌队列读取失败</p>
						<p class="mt-1 text-xs text-muted-foreground">
							原因：{queueError}。这<b>不代表队列为空</b>；顺带确认点歌站可访问、地址正确、
							API Key（cims_vhub_key）具备 songs:read 权限，或点歌站是否允许本页跨域访问。
						</p>
						<Button variant="outline" size="sm" class="mt-3" onclick={loadQueue}>
							<RefreshCw class="mr-1.5 size-3.5" /> 重试
						</Button>
					</div>
				</div>
			{:else}
				<div>
					<h3 class="mb-2 text-xs font-medium text-muted-foreground">正在播放</h3>
					{#if now}
						<div class="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-sm">
							<b class="text-foreground">{now.title}</b>
							{#if now.artist}<span class="text-muted-foreground"> — {now.artist}</span>{/if}
							<span class="text-xs text-muted-foreground">
								{#if now.by} · {now.by}{/if}{#if now.at} · {now.at}{/if}
							</span>
						</div>
					{:else}
						<p class="text-sm text-muted-foreground">暂无播放中曲目</p>
					{/if}
				</div>

				<div>
					<h3 class="mb-2 text-xs font-medium text-muted-foreground">待播队列（{queue.length}）</h3>
					{#if queue.length}
						<div class="overflow-x-auto rounded-lg border">
							<table class="w-full min-w-[560px] border-collapse text-sm">
								<thead>
									<tr class="border-b bg-muted/40 text-left text-xs text-muted-foreground">
										<th class="px-3 py-2 font-medium">歌曲</th>
										<th class="px-3 py-2 font-medium">歌手</th>
										<th class="px-3 py-2 font-medium">点歌人</th>
										<th class="px-3 py-2 font-medium">票数</th>
										<th class="px-3 py-2 font-medium">提交时间</th>
									</tr>
								</thead>
								<tbody>
									{#each queue as s (s.id)}
										<tr class="border-b last:border-0">
											<td class="px-3 py-2 font-medium">{s.title}</td>
											<td class="px-3 py-2 text-muted-foreground">{s.artist || "—"}</td>
											<td class="px-3 py-2 text-muted-foreground">{s.by || "—"}</td>
											<td class="px-3 py-2 tabular-nums text-muted-foreground">{s.votes}</td>
											<td class="px-3 py-2 text-muted-foreground">{s.at || "—"}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{:else}
						<p class="text-sm text-muted-foreground">队列为空</p>
					{/if}
				</div>
			{/if}
		</CardContent>
	</Card>

	<p class="flex items-center gap-1.5 text-xs text-muted-foreground">
		<ExternalLink class="size-3.5" />
		队列显示只读；点歌、投票等操作请在上方内嵌的点歌站内完成。
	</p>
</div>
