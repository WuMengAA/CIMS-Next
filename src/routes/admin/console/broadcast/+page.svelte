<script lang="ts">
	import { onMount } from "svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Textarea } from "$lib/components/ui/textarea/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { toast } from "svelte-sonner";
	import { Megaphone, Send, CheckCircle2, AlertTriangle, Loader2 } from "@lucide/svelte";

	// 互动广播发布面板（网站端）：在集控「通知广播」能力之上补一个**一键发布**入口——
	// 发布按钮 + 发布确认 + 回执状态展示，对接现有广播接口
	// POST /api/console/control/notices（该接口会在服务端把通知**真推送到教室端大屏**）。
	//
	// 为什么放这里（/admin/console/broadcast）而不是 /admin/broadcast：
	// 后台非 console 路由统一卡 viewAdmin(L5)，而广播是「设备轴 control + 广播范围」
	// 的能力，电教委员/老师(L2+)也应能发布；本页与集控面板同门槛(viewConsole)，
	// 由下方发布接口按角色二次收敛可达范围（并非前端权限边界）。

	type PublishResult = {
		id?: number;
		title?: string;
		scope?: string;
		sent?: number;
		broadcast?: {
			ok?: boolean;
			delivered?: number;
			total?: number;
			deduped?: boolean;
			error?: string;
		};
		error?: string;
	};

	let title = $state("");
	let content = $state("");
	// ⚠️ 2026-10-01 修：范围下拉原先把 本班/本年级/全校 三档**写死**，而本页没有任何权限来源
	//    （没有 +page.server.ts，也不拉 /api/me），于是任课老师同样能选「全校」，
	//    一点发布就是服务端 403「当前账号最多只能广播到「本班」」。
	//    现在 onMount 拉 /api/me 的 identity.broadcastScopes，只列出真的发得出去的档，
	//    并把默认值定在该账号的上限（永远发得出去）。
	const SCOPE_ORDER = ["class", "grade", "school"] as const;
	const SCOPE_LABEL: Record<string, string> = { class: "本班", grade: "本年级", school: "全校" };
	let scopeOptions = $state<string[]>(["class"]);
	let maxLabel = $state("本班");
	let scope = $state<string>("本班");
	let duration = $state<number | undefined>(undefined);

	// v2（2026-09-25；2026-10-04 班级域收口 → /api/class/list）：目标班级只从真实班级出。
	// 旧版是手输自由文本（"多个班级用逗号分隔"）——拼错一个字就静默发不到，
	// 也没有了“班级选择列表不真实”的另一个入口。取不到=明示错误，绝不放假班。
	let classOptions = $state<{ class_id: string; name: string }[]>([]);
	let classOptionsErr = $state("");
	let pickedClasses = $state<string[]>([]);

	onMount(async () => {
		try {
			const res = await fetch("/api/class/list");
			const d = await res.json();
			if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
			classOptions = (d.classes ?? []).map((c: { class_id?: string; name?: string }) => ({
				class_id: String(c.class_id ?? ""),
				name: String(c.name ?? c.class_id ?? "")
			})).filter((c: { class_id: string }) => Boolean(c.class_id));
		} catch (e) {
			classOptionsErr = (e as Error).message || "班级列表加载失败";
		}
		// 广播范围：按当前账号的真实上限（服务端 identity.broadcastScopes）决定可选档。
		// 拉不到就维持最窄档 —— 安全侧永远收敛，绝不因为一个失败请求放开范围。
		try {
			const me = await (await fetch("/api/me")).json();
			const allowed: string[] = me?.identity?.broadcastScopes ?? [];
			const opts = SCOPE_ORDER.filter((s) => allowed.includes(s));
			if (opts.length) {
				scopeOptions = [...opts];
				maxLabel = SCOPE_LABEL[opts[opts.length - 1]];
				scope = maxLabel;
			}
		} catch { /* 维持最窄档 */ }
	});

	function parseClasses(): string[] {
		return pickedClasses.slice(0, 40);
	}

	let submitting = $state(false);
	let confirming = $state(false); // 发布确认态
	let result = $state<PublishResult | null>(null);

	async function doPublish() {
		if (!title.trim()) {
			toast.error("请填写广播标题");
			return;
		}
		// 纵深防御：绕过下拉（改 DOM / 旧缓存页面）时也把范围收敛到账号上限。
		if (!scopeOptions.some((s) => SCOPE_LABEL[s] === scope)) scope = maxLabel;
		confirming = false;
		submitting = true;
		result = null;
		try {
			const durRaw = Number(duration);
			const body: Record<string, unknown> = {
				title: title.trim(),
				content: content.trim(),
				scope,
				broadcast: true
			};
			const classes = parseClasses();
			if (scope === "本班" && classes.length) body.classes = classes;
			if (Number.isFinite(durRaw) && durRaw > 0) body.duration_seconds = Math.min(durRaw, 3600);

			const res = await fetch("/api/console/control/notices", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body)
			});
			const d = (await res.json()) as PublishResult;
			if (!res.ok) {
				result = { error: d.error || `发布失败（HTTP ${res.status}）` };
				toast.error(d.error || "发布失败");
				return;
			}
			result = d;
			const b = d.broadcast;
			if (b?.deduped) toast.success("内容重复，未重复下发（去重窗口内）");
			else if (b && (b.delivered ?? 0) > 0) toast.success(`已下发到 ${b.delivered} 台设备（是否收到看「指令回执」）`);
			else if (b?.error) toast.warning(`已留痕，但未下发成功：${b.error}`);
			else toast.success("已发布");
		} catch (e) {
			result = { error: "网络错误，请重试" };
			toast.error("网络错误，请重试");
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>互动广播发布 · 集控面板 | Stelarith</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-2xl p-4 md:p-6">
	<div class="mb-5 flex items-center gap-3">
		<div class="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
			<Megaphone class="size-5" />
		</div>
		<div>
			<h1 class="font-heading text-lg font-semibold">互动广播发布</h1>
			<p class="text-xs text-muted-foreground">发布后将推送到教室端大屏（自动去重，范围受你的账号权限约束）</p>
		</div>
	</div>

	<div class="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
		<div class="grid gap-4">
			<div class="grid gap-1.5">
				<Label for="bc-title">广播标题</Label>
				<input
					id="bc-title"
					type="text"
					bind:value={title}
					placeholder="例如：午休结束，请返回教室"
					maxlength="120"
					class="h-8 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:bg-input/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 w-full min-w-0 outline-none placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
				/>
			</div>
			<div class="grid gap-1.5">
				<Label for="bc-content">正文（选填）</Label>
				<Textarea id="bc-content" bind:value={content} placeholder="补充内容，可空" rows={3} />
			</div>
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<div class="grid gap-1.5">
					<Label for="bc-scope">广播范围</Label>
					<select
						id="bc-scope"
						bind:value={scope}
						class="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
					>
						{#each scopeOptions as s (s)}<option value={SCOPE_LABEL[s]}>{SCOPE_LABEL[s]}</option>{/each}
					</select>
				</div>
				<div class="grid gap-1.5">
					<Label for="bc-dur">显示时长（秒，选填）</Label>
					<input
					id="bc-dur"
					type="number"
					min="1"
					max="3600"
					bind:value={duration}
					placeholder="留空由教室端自适应"
					class="h-8 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:bg-input/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 w-full min-w-0 outline-none placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
				/>
				</div>
			</div>
			{#if scope === "本班"}
				<div class="grid gap-1.5">
					<Label for="bc-classes">目标班级（选填，默认你绑定的班级）</Label>
					{#if classOptionsErr}
						<p class="text-xs text-destructive" id="bc-classes">
							班级列表不可用：{classOptionsErr}（本次只能发往你绑定的班级）
						</p>
					{:else if classOptions.length}
						<div id="bc-classes" class="flex flex-wrap gap-2">
							{#each classOptions as c (c.class_id)}
								<label
									class="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm {pickedClasses.includes(c.class_id) ? 'border-primary bg-primary/10' : 'border-border'}"
								>
									<input type="checkbox" class="accent-primary" bind:group={pickedClasses} value={c.class_id} />
									{c.name}
								</label>
							{/each}
						</div>
						<p class="text-xs text-muted-foreground">
							只能选你绑定范围内的班级（发布时服务端会再次校验）；不选则推送到你绑定的全部班。
						</p>
					{:else}
						<p class="text-xs text-muted-foreground" id="bc-classes">正在加载真实班级…</p>
					{/if}
				</div>
			{/if}

			<div class="flex items-center gap-2 pt-1">
				<Button onclick={() => (confirming = true)} disabled={submitting || !title.trim()} class="gap-1.5">
					<Send class="size-4" /> 发布
				</Button>
				{#if submitting}<span class="text-xs text-muted-foreground inline-flex items-center gap-1"><Loader2 class="size-3.5 animate-spin" /> 发布中…</span>{/if}
			</div>
		</div>
	</div>

	{#if confirming}
		<div class="mt-4 rounded-xl border border-primary/40 bg-primary/5 p-4">
			<p class="text-sm font-medium">确认发布到【{scope}】{scope === "本班" && pickedClasses.length ? `（选定 ${pickedClasses.length} 个班）` : ""}？</p>
			<p class="mt-1 text-xs text-muted-foreground">标题：{title.trim()}{content.trim() ? ` · 正文 ${content.trim().length} 字` : ""}</p>
			<div class="mt-3 flex items-center gap-2">
				<Button onclick={doPublish} disabled={submitting} class="gap-1.5">
					<Send class="size-4" /> 确认发布
				</Button>
				<Button variant="outline" onclick={() => (confirming = false)}>取消</Button>
			</div>
		</div>
	{/if}

	{#if result}
		<div class="mt-4 rounded-xl border border-border/60 bg-card p-4">
			<div class="flex items-center gap-2">
				{#if result.error}
					<AlertTriangle class="size-4 text-destructive" />
					<span class="text-sm font-medium text-destructive">发布未成功</span>
				{:else}
					<CheckCircle2 class="size-4 text-emerald-500" />
					<span class="text-sm font-medium">发布回执</span>
				{/if}
			</div>
			{#if result.error}
				<p class="mt-1 text-sm text-muted-foreground">{result.error}</p>
			{:else}
				<div class="mt-2 grid gap-1.5 text-sm">
					<div class="flex items-center gap-2"><span class="text-muted-foreground">标题：</span><span>{result.title}</span></div>
					<div class="flex items-center gap-2"><span class="text-muted-foreground">范围：</span><Badge variant="secondary">{result.scope}</Badge></div>
					{#if result.broadcast}
						<div class="flex items-center gap-2">
							<span class="text-muted-foreground">已下发：</span>
							<span>
								{result.broadcast.deduped ? "去重命中，未重复下发" : `${result.broadcast.delivered ?? 0} / ${result.broadcast.total ?? 0} 台设备`}
							</span>
							<!-- 诚实 UI：CIMS 回 200 只代表「入队成功」，不代表设备收到。
							     真正的送达要看设备回执（指令回执页），不能在这里冒充送达。 -->
							{#if !result.broadcast.deduped}
								<a href="/admin/console/receipts" class="text-xs text-primary underline-offset-4 hover:underline">去「指令回执」看是否收到 →</a>
							{/if}
						</div>
						{#if result.broadcast.error}
							<div class="flex items-center gap-2 text-amber-600"><AlertTriangle class="size-3.5" /><span>推送警告：{result.broadcast.error}</span></div>
						{/if}
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>
