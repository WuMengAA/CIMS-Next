<script lang="ts">
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Textarea } from "$lib/components/ui/textarea/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Megaphone, Send, Loader2 } from "@lucide/svelte";
	import type { PageData } from "./$types";

	// 发布通知（Svelte 版 · 2026-09-26 从原生面板迁移）。
	// 发布走 /api/console/ext/notices（服务端 broadcastToClassrooms：留痕 + 推送教室端）；
	// 呈现方式/预设回复/自动关屏随 flags 下发，范围受账号权限约束（服务端强制）。
	let { data }: { data: PageData } = $props();

	type Notice = { id?: string|number; title: string; scope: string; classes: string[]; channel: string; sent: number; at: string };

	let title = $state("");
	let content = $state("");
	let scope = $state<"本班" | "本年级" | "全校">("本班");
	let duration = $state<number | undefined>(undefined);
	let ntType = $state("");
	let presetsText = $state("");
	let emergency = $state(false);
	let adsText = $state("");
	let classes = $state<{ class_id: string; name: string; device_count: number }[]>([]);
	let picked = $state<string[]>([]);
	let notices = $state<Notice[]>([]);
	let submitting = $state(false);
	let classErr = $state("");

	onMount(async () => {
		try {
			const [cRes, nRes] = await Promise.all([
				fetch("/api/classes"),
				fetch("/api/console/ext/notices"),
			]);
			const c = await cRes.json();
			if (cRes.ok) {
				classes = (c.classes ?? []).map((x: { class_id?: string; name?: string; device_count?: number }) => ({ class_id: String(x.class_id ?? ""), name: String(x.name ?? ""), device_count: Number(x.device_count ?? 0) })).filter((x) => x.class_id);
				picked = classes.filter((x) => x.name === data.className).map((x) => x.name);
			} else { classErr = c.error || "班级列表加载失败"; }
			const n = await nRes.json();
			notices = Array.isArray(n) ? n.map(norm) : [];
		} catch (e) {
			classErr = (e as Error)?.message || "加载失败";
		}
	});

	function norm(n: Record<string, unknown>): Notice {
		return {
			id: n.id ?? "", title: String(n.title ?? ""), scope: String(n.scope ?? "本班"),
			classes: Array.isArray(n.classes) ? n.classes.map(String) : [],
			channel: String(n.channel ?? ""), sent: Number(n.sent ?? 0), at: String(n.at ?? n.createdAt ?? ""),
		};
	}

	function presets(): string[] {
		return presetsText.split(/[,，、]/).map((s) => s.trim()).filter(Boolean).slice(0, 6);
	}

	async function doSend() {
		if (!title.trim()) { toast.error("请填写通知标题"); return; }
		submitting = true;
		try {
			const flags: Record<string, unknown> = {};
			const ps = presets();
			if (ps.length) flags.reply_presets = ps;
			if (emergency) flags.emergency_confirm = true;
			const ads = Number(adsText);
			if (Number.isFinite(ads) && ads > 0 && ads <= 300) flags.auto_dismiss_seconds = Math.round(ads);
			const body: Record<string, unknown> = { title: title.trim(), content: content.trim(), scope, broadcast: true };
			if (scope === "本班" && picked.length) body.classes = picked;
			if (ntType) body.type = ntType;
			if (Object.keys(flags).length) body.flags = flags;
			const durRaw = Number(duration);
			if (Number.isFinite(durRaw) && durRaw > 0) body.duration_seconds = Math.min(durRaw, 3600);
			const res = await fetch("/api/console/ext/notices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
			const d = await res.json();
			if (!res.ok) { toast.error(d.error || "发布失败"); return; }
			const b = d.broadcast;
			if (b?.deduped) toast.success("内容重复，未重复下发（去重窗口内）");
			else if (b && (b.delivered ?? 0) > 0) toast.success(`已发布并推送到 ${b.delivered} 台设备`);
			else if (b?.error) toast.warning(`已留痕，但推送未送达：${b.error}`);
			else toast.success("已发布");
			title = ""; content = ""; presetsText = ""; adsText = ""; emergency = false; ntType = "";
			const nRes = await fetch("/api/console/ext/notices");
			notices = Array.isArray(await nRes.json()) ? (await (await fetch("/api/console/ext/notices")).json()).map(norm) : [];
		} catch (e) {
			toast.error("网络错误，请重试");
		} finally {
			submitting = false;
		}
	}

	const SCOPE_LABEL: Record<string, string> = { class: "本班", grade: "本年级", school: "全校" };
	const maxLabel = $derived((data.broadcastScopes?.length ? SCOPE_LABEL[data.broadcastScopes[data.broadcastScopes.length - 1]] : "") || "本班");
</script>
<svelte:head>
	<title>发布通知 · 集控面板 | Stelarith</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-4xl p-4 md:p-6">
	<div class="mb-5 flex items-center gap-3">
		<div class="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary"><Megaphone class="size-5" /></div>
		<div>
			<h1 class="font-heading text-lg font-semibold">发布通知</h1>
			<p class="text-xs text-muted-foreground">发布后会经 CIMS 命令通道推送到目标教室大屏；同内容 30 秒内重复提交自动去重。</p>
		</div>
	</div>

	<div class="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
		<div class="grid gap-4">
			<div class="grid gap-1.5">
				<Label for="nt-title">通知标题</Label>
				<input id="nt-title" type="text" bind:value={title} placeholder="例如：午休结束，请返回教室" maxlength="120" class="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:bg-input/50 md:text-sm dark:bg-input/30" />
			</div>
			<div class="grid gap-1.5">
				<Label for="nt-content">正文（选填）</Label>
				<Textarea id="nt-content" bind:value={content} placeholder="补充内容，可空" rows={3} />
			</div>
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
				<div class="grid gap-1.5">
					<Label for="nt-scope">广播范围</Label>
					<select id="nt-scope" bind:value={scope} class="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring">
						<option value="本班">本班</option><option value="本年级">本年级</option><option value="全校">全校</option>
					</select>
				</div>
				<div class="grid gap-1.5">
					<Label for="nt-type">呈现方式</Label>
					<select id="nt-type" bind:value={ntType} class="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring">
						<option value="">普通通知</option>
						<option value="island">课表岛 · 顶部滚动</option>
						{#if data.role === "admin" || data.role === "owner" || data.role === "homeroom"}<option value="popup">弹窗 · 需要确认</option>{/if}
						{#if data.role === "admin" || data.role === "owner"}<option value="fullscreen">全屏 · 置顶紧急</option>{/if}
					</select>
				</div>
				<div class="grid gap-1.5">
					<Label for="nt-dur">显示时长（秒，选填）</Label>
					<input id="nt-dur" type="number" min="1" max="3600" bind:value={duration} placeholder="留空自适应" class="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm" />
				</div>
			</div>
			{#if ntType === "popup" || ntType === "fullscreen"}
				<div class="grid gap-1.5">
					<Label for="nt-presets">预设回复（弹窗；逗号分隔，最多 6 条）</Label>
					<input id="nt-presets" type="text" bind:value={presetsText} placeholder="如：下课再处理,已收到" class="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm" />
				</div>
				<div class="flex items-center gap-4">
					<label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={emergency} class="accent-primary" /> 需确认</label>
					<div class="flex items-center gap-2">
						<Label for="nt-ads" class="shrink-0">自动关屏（秒）</Label>
						<input id="nt-ads" type="number" min="1" max="300" bind:value={adsText} placeholder="留空=不自动关" class="h-8 w-32 rounded-lg border border-input bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50" />
					</div>
				</div>
			{/if}
			<div class="grid gap-1.5">
				<Label>目标班级（选填，默认范围决定）</Label>
				{#if classErr}
					<p class="text-xs text-destructive">{classErr}（本次只能发往你绑定的班级）</p>
				{:else if classes.length}
					<div class="flex flex-wrap gap-2">
						{#each classes as c (c.class_id)}
							<label class="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm {picked.includes(c.name) ? "border-primary bg-primary/10" : "border-border"}">
								<input type="checkbox" class="accent-primary" bind:group={picked} value={c.name} /> {c.name}<span class="text-xs text-muted-foreground">{c.device_count} 台</span>
							</label>
						{/each}
					</div>
					<div class="flex gap-2 text-xs">
						<Button variant="outline" size="sm" class="h-7 px-2" onclick={() => (picked = classes.map((c) => c.name))}>全选</Button>
						<Button variant="outline" size="sm" class="h-7 px-2" onclick={() => (picked = [])}>清空</Button>
						{#if data.className}<Button variant="outline" size="sm" class="h-7 px-2" onclick={() => (picked = classes.filter((c) => c.name === data.className).map((c) => c.name))}>仅本班（{data.className}）</Button>{/if}
					</div>
				{:else}
					<p class="text-xs text-muted-foreground">正在加载真实班级…</p>
				{/if}
			</div>
			<div class="flex items-center gap-2 pt-1">
				<Button onclick={doSend} disabled={submitting || !title.trim()} class="gap-1.5"><Send class="size-4" /> 发布</Button>
				{#if submitting}<span class="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 class="size-3.5 animate-spin" /> 发布中…</span>{/if}
				<span class="text-xs text-muted-foreground">本账号可广播最大范围：<b>{maxLabel}</b></span>
			</div>
		</div>
	</div>

	<div class="mt-5 rounded-xl border border-border/60 bg-card p-5 shadow-sm">
		<h2 class="mb-3 text-sm font-semibold">历史通知</h2>
		{#if !notices.length}
			<p class="py-6 text-center text-sm text-muted-foreground">暂无通知记录</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead><tr class="border-b text-left text-xs text-muted-foreground">
						<th class="py-2 pr-3 font-medium">时间</th><th class="py-2 pr-3 font-medium">标题</th><th class="py-2 pr-3 font-medium">范围</th><th class="py-2 pr-3 font-medium">目标班级</th><th class="py-2 pr-3 font-medium">通道</th><th class="py-2 font-medium">送达</th>
					</tr></thead>
					<tbody>
						{#each notices as n (n.id)}
							<tr class="border-b">
								<td class="py-2 pr-3 text-xs text-muted-foreground">{n.at}</td>
								<td class="py-2 pr-3">{n.title}</td>
								<td class="py-2 pr-3"><Badge variant="secondary">{n.scope}</Badge></td>
								<td class="py-2 pr-3 text-xs text-muted-foreground">{n.classes.length ? n.classes.join("、") : "—"}</td>
								<td class="py-2 pr-3 text-xs text-muted-foreground">{n.channel || "—"}</td>
								<td class="py-2"><Badge variant={n.sent ? "default" : "destructive"}>{n.sent || 0}</Badge></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</div>