<script lang="ts">
	/**
	 * 站内 Issues 面板（类 GitHub）。
	 *
	 * 交互取舍：
	 * - 详情**内联展开**而非跳转独立页：展板本身就是「一屏看完」的场景，跳页会打断浏览。
	 * - 正文按**纯文本**渲染（whitespace-pre-wrap）而不是走 markdown：Issue 来自任意登录用户，
	 *   服务端 markdown 渲染是开 HTML 的（`html: true`），直接渲染等于开了一个 XSS 口子。
	 * - 列表初始数据由 SSR 下发（首屏不闪），之后的筛选/搜索/评论都走客户端 fetch。
	 */
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { MessageSquare, CircleDot, CheckCircle2, Plus, Search, Trash2, X } from "@lucide/svelte";

	export interface Issue {
		id: number;
		number: number;
		title: string;
		body: string;
		author: string;
		state: "open" | "closed";
		labels: string[];
		createdAt: string;
		closedAt: string;
		commentCount?: number;
	}
	interface Comment {
		id: number;
		author: string;
		body: string;
		createdAt: string;
	}

	let {
		slug,
		issues: initialIssues = [],
		stats: initialStats = { open: 0, closed: 0, total: 0 },
		user = null,
		canSubmit = false,
		canModerate = false
	}: {
		slug: string;
		issues?: Issue[];
		stats?: { open: number; closed: number; total: number };
		user?: { username: string; role: string } | null;
		canSubmit?: boolean;
		canModerate?: boolean;
	} = $props();

	let issues = $state<Issue[]>(initialIssues);
	let stats = $state(initialStats);
	let filter = $state<"open" | "closed" | "all">("open");
	let q = $state("");
	let busy = $state(false);
	let err = $state("");

	// 新建表单
	let composing = $state(false);
	let newTitle = $state("");
	let newBody = $state("");
	let newLabels = $state("");

	// 详情
	let openNumber = $state<number | null>(null);
	let detail = $state<{ issue: Issue; comments: Comment[] } | null>(null);
	let replyBody = $state("");

	const visible = $derived.by(() => {
		const kw = q.trim().toLowerCase();
		return issues.filter((i) => {
			if (filter !== "all" && i.state !== filter) return false;
			if (kw && !i.title.toLowerCase().includes(kw) && !i.body.toLowerCase().includes(kw)) return false;
			return true;
		});
	});

	const LABEL_PRESETS = ["bug", "enhancement", "question", "documentation", "wontfix"];

	function fmt(iso: string): string {
		if (!iso) return "";
		try {
			return new Date(iso).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
		} catch {
			return iso.slice(0, 10);
		}
	}

	async function reload() {
		try {
			const res = await fetch(`/api/project-board/issues?slug=${encodeURIComponent(slug)}&state=all`);
			if (!res.ok) return;
			const j = await res.json();
			issues = j.issues ?? [];
			stats = j.stats ?? stats;
		} catch {
			/* 静默：下一次操作会再试 */
		}
	}

	async function act(action: string, payload: Record<string, unknown>): Promise<any> {
		busy = true;
		err = "";
		try {
			const res = await fetch("/api/project-board/issues", {
				method: "POST",
				headers: { "Content-Type": "application/json", "x-action": action },
				body: JSON.stringify({ slug, ...payload })
			});
			const j = await res.json().catch(() => ({}));
			if (!res.ok) {
				err = j.error || `操作失败（${res.status}）`;
				return null;
			}
			return j;
		} catch (e) {
			err = "网络错误，请重试";
			return null;
		} finally {
			busy = false;
		}
	}

	async function submitIssue() {
		if (newTitle.trim().length < 2) {
			err = "标题至少 2 个字";
			return;
		}
		const labels = newLabels
			.split(/[,，\s]+/)
			.map((s) => s.trim())
			.filter(Boolean)
			.slice(0, 5);
		const j = await act("create", { title: newTitle.trim(), body: newBody.trim(), labels });
		if (!j) return;
		newTitle = "";
		newBody = "";
		newLabels = "";
		composing = false;
		await reload();
		filter = "open";
	}

	async function toggleState(issue: Issue) {
		const next = issue.state === "open" ? "closed" : "open";
		const j = await act("state", { number: issue.number, state: next });
		if (!j) return;
		await reload();
		if (detail?.issue.number === issue.number) await loadDetail(issue.number);
	}

	async function removeIssue(issue: Issue) {
		if (!confirm(`确定删除 #${issue.number}「${issue.title}」？此操作不可撤销。`)) return;
		const j = await act("delete", { number: issue.number });
		if (!j) return;
		if (openNumber === issue.number) {
			openNumber = null;
			detail = null;
		}
		await reload();
	}

	async function loadDetail(number: number) {
		try {
			const res = await fetch(
				`/api/project-board/issues?slug=${encodeURIComponent(slug)}&number=${number}`
			);
			if (!res.ok) return;
			detail = await res.json();
		} catch {
			/* 忽略 */
		}
	}

	async function toggleDetail(number: number) {
		if (openNumber === number) {
			openNumber = null;
			detail = null;
			return;
		}
		openNumber = number;
		detail = null;
		await loadDetail(number);
	}

	async function sendReply() {
		if (!replyBody.trim() || !openNumber) return;
		const j = await act("comment", { number: openNumber, body: replyBody.trim() });
		if (!j) return;
		replyBody = "";
		await loadDetail(openNumber);
		await reload();
	}

	/** 标签配色：把常用标签固定语义色，未知标签回落到中性描边，避免随机色导致视觉噪音。 */
	function labelClass(l: string): string {
		const k = l.toLowerCase();
		if (k === "bug") return "border-red-500/50 text-red-600 dark:text-red-400";
		if (k === "enhancement") return "border-emerald-500/50 text-emerald-600 dark:text-emerald-400";
		if (k === "question") return "border-sky-500/50 text-sky-600 dark:text-sky-400";
		if (k === "documentation") return "border-violet-500/50 text-violet-600 dark:text-violet-400";
		if (k === "wontfix") return "border-border text-muted-foreground";
		return "border-border text-muted-foreground";
	}
</script>

<div class="rounded-xl border border-border/60 bg-card">
	<!-- 头部 -->
	<header class="flex flex-wrap items-center gap-2 border-b border-border/40 px-4 py-3">
		<MessageSquare class="size-4 text-primary" />
		<h3 class="font-heading text-sm font-medium">Issues</h3>
		<span class="flex items-center gap-1 text-xs text-muted-foreground">
			<CircleDot class="size-3" />{stats.open} 打开
		</span>
		<span class="flex items-center gap-1 text-xs text-muted-foreground">
			<CheckCircle2 class="size-3" />{stats.closed} 已关闭
		</span>
		{#if user && canSubmit}
			<Button size="sm" variant="outline" class="ml-auto" onclick={() => (composing = !composing)}>
				{#if composing}<X class="size-3.5 mr-1" />取消{:else}<Plus class="size-3.5 mr-1" />新建 Issue{/if}
			</Button>
		{:else if !user}
			<a
				href="/admin/login"
				class="ml-auto text-xs text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
			>登录后可提交 Issue</a>
		{/if}
	</header>

	<!-- 新建表单 -->
	{#if composing}
		<div class="border-b border-border/40 bg-muted/20 px-4 py-3">
			<div class="flex flex-col gap-2">
				<Input bind:value={newTitle} placeholder="标题：用一句话说明问题或建议" class="h-9" maxlength={160} />
				<textarea
					bind:value={newBody}
					rows="5"
					maxlength={8000}
					placeholder="详细描述：复现步骤、期望行为、环境信息…（纯文本，支持换行）"
					class="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
				></textarea>
				<div class="flex flex-wrap items-center gap-2">
					<Input bind:value={newLabels} placeholder="标签（可选，逗号分隔）：bug, enhancement" class="h-8 max-w-xs" />
					<div class="flex flex-wrap gap-1">
						{#each LABEL_PRESETS as p}
							<button
								type="button"
								class="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
								onclick={() => {
									const cur = newLabels.split(/[,，\s]+/).filter(Boolean);
									if (!cur.includes(p)) newLabels = [...cur, p].join(", ");
								}}>{p}</button>
						{/each}
					</div>
					<Button size="sm" class="ml-auto" disabled={busy || newTitle.trim().length < 2} onclick={submitIssue}>
						{busy ? "提交中…" : "提交 Issue"}
					</Button>
				</div>
			</div>
		</div>
	{/if}

	<!-- 筛选 -->
	<div class="flex flex-wrap items-center gap-2 border-b border-border/40 px-4 py-2">
		<div class="flex overflow-hidden rounded-md border border-border/60">
			{#each [{ k: "open", t: "打开" }, { k: "closed", t: "已关闭" }, { k: "all", t: "全部" }] as tab}
				<button
					type="button"
					class="px-2.5 py-1 text-xs transition-colors {filter === tab.k
						? 'bg-primary/15 text-primary'
						: 'text-muted-foreground hover:bg-muted/60'}"
					onclick={() => (filter = tab.k as any)}>{tab.t}</button>
			{/each}
		</div>
		<div class="relative ml-auto w-40">
			<Search class="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
			<Input bind:value={q} placeholder="搜索" class="h-7 pl-7 text-xs" />
		</div>
	</div>

	{#if err}
		<p class="mx-4 mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{err}</p>
	{/if}

	<!-- 列表 -->
	<div class="divide-y divide-border/40">
		{#if visible.length === 0}
			<p class="px-4 py-8 text-center text-sm text-muted-foreground">
				{q.trim() ? "没有匹配的 Issue。" : filter === "closed" ? "还没有已关闭的 Issue。" : "还没有 Issue —— 有想法就来提一个吧。"}
			</p>
		{/if}
		{#each visible as issue (issue.id)}
			<div>
				<button
					type="button"
					class="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30"
					onclick={() => toggleDetail(issue.number)}
				>
					<span class="mt-0.5 shrink-0">
						{#if issue.state === "open"}
							<CircleDot class="size-4 text-emerald-600 dark:text-emerald-400" />
						{:else}
							<CheckCircle2 class="size-4 text-muted-foreground" />
						{/if}
					</span>
					<div class="min-w-0 flex-1">
						<div class="flex flex-wrap items-center gap-2">
							<span class="font-medium {issue.state === 'closed' ? 'text-muted-foreground' : ''}">{issue.title}</span>
							{#each issue.labels as l (l)}
								<span class="rounded-full border px-1.5 py-px text-[10px] {labelClass(l)}">{l}</span>
							{/each}
						</div>
						<p class="mt-0.5 text-xs text-muted-foreground">
							#{issue.number} · {issue.author || "匿名"} 于 {fmt(issue.createdAt)} 提交
							{#if issue.commentCount}<span class="ml-2">💬 {issue.commentCount}</span>{/if}
						</p>
					</div>
				</button>

				<!-- 详情 -->
				{#if openNumber === issue.number}
					<div class="border-t border-border/30 bg-muted/10 px-4 py-3">
						{#if !detail}
							<p class="text-xs text-muted-foreground">加载中…</p>
						{:else}
							<div class="mb-3 whitespace-pre-wrap rounded-md border border-border/40 bg-background p-3 text-sm">
								{detail.issue.body || "（未填写正文）"}
							</div>

							{#each detail.comments as c (c.id)}
								<div class="mb-2 flex gap-2">
									<div class="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-medium text-primary">
										{(c.author || "?").slice(0, 1).toUpperCase()}
									</div>
									<div class="min-w-0 flex-1">
										<p class="text-[11px] text-muted-foreground">{c.author} · {fmt(c.createdAt)}</p>
										<p class="whitespace-pre-wrap text-sm">{c.body}</p>
									</div>
								</div>
							{/each}

							{#if user}
								<div class="mt-3 flex flex-col gap-2">
									<textarea
										bind:value={replyBody}
										rows="3"
										placeholder="写下回复…"
										class="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
									></textarea>
									<div class="flex flex-wrap items-center gap-2">
										<Button size="sm" disabled={busy || !replyBody.trim()} onclick={sendReply}>回复</Button>
										<Button size="sm" variant="outline" disabled={busy} onclick={() => toggleState(issue)}>
											{issue.state === "open" ? "关闭 Issue" : "重新打开"}
										</Button>
										{#if canModerate}
											<Button
												size="sm"
												variant="ghost"
												class="ml-auto text-destructive hover:text-destructive"
												disabled={busy}
												onclick={() => removeIssue(issue)}
											><Trash2 class="size-3.5 mr-1" />删除</Button>
										{/if}
									</div>
								</div>
							{:else}
								<p class="mt-3 text-xs text-muted-foreground">
									<a href="/admin/login" class="text-primary hover:underline">登录</a> 后可参与讨论。
								</p>
							{/if}
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>
</div>
