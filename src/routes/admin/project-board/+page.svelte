<script lang="ts">
	/**
	 * 项目展板管理台。
	 *
	 * 交互模型：**左侧选项目，右侧编辑该项目的展板**。不用「一个项目一页」是因为
	 * 运维动作（绑定仓库 / 同步 / 传发行）天然是「扫过一遍所有项目」的批量心态，
	 * 切页会打断节奏。
	 *
	 * 待办与里程碑走「本地编辑 → 显式保存」，发行与同步是「即时生效」：
	 * 前者是需要反复微调的文本清单，后者是带副作用的一次性动作，混在一起很容易
	 * 误保存半成品。
	 */
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import {
		RefreshCw, Save, Plus, Trash2, ArrowUp, ArrowDown, Upload, Link2,
		CheckCircle2, AlertTriangle, CircleDot, Package, Star, GitFork, GitCommitHorizontal, Wifi
	} from "@lucide/svelte";
	import { Github } from "$lib/components/icons/index.js";
	import { onMount } from "svelte";

	let { data }: { data: { projects: any[]; boards: any[]; github: { hasToken: boolean } } } = $props();

	// ── 选中项目 ──
	let slug = $state<string>(data.projects[0]?.slug ?? "");
	const current = $derived(data.projects.find((p) => p.slug === slug) ?? null);

	// 本地副本：call() 保存成功后会替换其中一条。直接改 props 下的 data.boards
	// 在 SvelteKit 的不可变数据流里不保证触发响应，本地 state 才可靠。
	let boards = $state<any[]>(structuredClone(data.boards));

	function pickBoard(s: string): any {
		return boards.find((b) => b.slug === s) ?? null;
	}
	let board = $state<any>(null);

	// ── 通用状态 ──
	let busy = $state(false);
	let msg = $state("");
	let err = $state("");
	let ghInfo = $state<any>(null);

	// ── 仓库绑定 ──
	let repoInput = $state("");
	let tagline = $state("");

	// ── 待办 / 里程碑缓冲 ──
	let todos = $state<any[]>([]);
	let milestones = $state<any[]>([]);
	let newTodo = $state("");
	let newTodoGroup = $state("");
	let newMs = $state("");

	// ── 发行上传 ──
	let relTag = $state("");
	let relName = $state("");
	let relNotes = $state("");
	let relPrerelease = $state(false);
	let uploading = $state(false);
	let lastUpload = $state<{ file: string; url: string; size: number } | null>(null);

	/**
	 * 切换项目：重置所有编辑缓冲。
	 * **刻意不做成 `$effect`** —— 保存成功后 boards 会变，若让 effect 监听到它，
	 * 就会把刚写的编辑缓冲、以及 `flash()` 刚设好的提示语一起冲掉（表现为
	 * 「点了保存却没有任何反馈」）。显式调用则一切可控。
	 */
	function selectProject(s: string) {
		slug = s;
		board = pickBoard(s);
		repoInput = board?.repo ?? "";
		tagline = board?.tagline ?? "";
		todos = structuredClone(board?.todos ?? []);
		milestones = structuredClone(board?.milestones ?? []);
		relTag = "";
		relName = "";
		relNotes = "";
		relPrerelease = false;
		lastUpload = null;
		msg = "";
		err = "";
		void loadIssues();
	}

	onMount(() => {
		if (slug) selectProject(slug);
	});

	function flash(text: string) {
		msg = text;
		err = "";
		setTimeout(() => {
			if (msg === text) msg = "";
		}, 3000);
	}

	async function call(action: string, payload: Record<string, unknown>): Promise<any> {
		busy = true;
		err = "";
		try {
			const res = await fetch("/api/project-board", {
				method: "POST",
				headers: { "Content-Type": "application/json", "x-action": action },
				body: JSON.stringify({ slug, ...payload })
			});
			const j = await res.json().catch(() => ({}));
			if (!res.ok) {
				err = j.error || `失败（${res.status}）`;
				return null;
			}
			if (j.board) {
				const idx = boards.findIndex((b: any) => b.slug === j.board.slug);
				if (idx >= 0) boards[idx] = j.board;
				else boards.push(j.board);
				board = j.board;
			}
			return j;
		} catch (e) {
			err = "网络错误：" + (e as Error).message;
			return null;
		} finally {
			busy = false;
		}
	}

	// ── 保存仓库绑定 ──
	async function saveRepo() {
		const j = await call("saveBoard", { repo: repoInput.trim(), tagline: tagline.trim() });
		if (j) flash("已保存仓库绑定");
	}

	// ── 同步 ──
	async function syncOne(withReleases: boolean) {
		const j = await call("sync", { slug, withReleases });
		if (!j) return;
		if (j.ok) flash(withReleases ? "同步完成（含发行）" : "同步完成");
		else err = j.error || "同步失败";
	}

	async function syncAll(withReleases: boolean) {
		if (!confirm(`确定同步全部已绑定仓库？${withReleases ? "（会一并拉取 GitHub 发行列表）" : ""}`)) return;
		const j = await call("sync", { all: true, withReleases });
		if (!j) return;
		const ok = (j.results ?? []).filter((r: any) => r.ok).length;
		const fail = (j.results ?? []).filter((r: any) => !r.ok);
		flash(`同步完成：成功 ${ok} 个${fail.length ? `，失败 ${fail.length} 个` : ""}`);
		if (fail.length) err = fail.map((f: any) => `${f.slug}: ${f.error}`).join("；");
	}

	async function testGithub() {
		const j = await call("testGithub", {});
		if (j) ghInfo = j;
	}

	// ── 待办编辑 ──
	function addTodo() {
		if (!newTodo.trim()) return;
		todos = [...todos, { id: `local_${Date.now()}`, title: newTodo.trim(), done: false, group: newTodoGroup.trim(), order: todos.length }];
		newTodo = "";
	}
	function delTodo(i: number) {
		todos = todos.filter((_, idx) => idx !== i).map((t, idx) => ({ ...t, order: idx }));
	}
	function moveTodo(i: number, dir: number) {
		const next = [...todos];
		const t = i + dir;
		if (t < 0 || t >= next.length) return;
		[next[i], next[t]] = [next[t], next[i]];
		todos = next.map((x, idx) => ({ ...x, order: idx }));
	}
	async function saveTodos() {
		const j = await call("setTodos", { todos });
		if (j) flash("待办已保存");
	}

	// ── 里程碑 ──
	function addMs() {
		if (!newMs.trim()) return;
		milestones = [...milestones, { id: `local_${Date.now()}`, title: newMs.trim(), due: "", state: "open" }];
		newMs = "";
	}
	async function saveMilestones() {
		const j = await call("saveBoard", { repo: board?.repo ?? "", tagline, milestones });
		if (j) flash("里程碑已保存");
	}

	// ── 发行 ──
	async function pickFile(e: Event) {
		const input = e.target as HTMLInputElement;
		const f = input.files?.[0];
		if (!f) return;
		uploading = true;
		err = "";
		try {
			const fd = new FormData();
			fd.append("file", f);
			const res = await fetch("/api/project-board/upload", { method: "POST", body: fd });
			const j = await res.json().catch(() => ({}));
			if (!res.ok) {
				err = j.error || "上传失败";
				return;
			}
			lastUpload = { file: j.file, url: j.url, size: j.size };
			if (!relName) relName = f.name.replace(/\.[^.]+$/, "");
			flash(`已上传 ${f.name}（${(j.size / 1024 / 1024).toFixed(1)} MB）`);
		} catch (e2) {
			err = "上传异常：" + (e2 as Error).message;
		} finally {
			uploading = false;
			input.value = "";
		}
	}

	async function addRelease() {
		if (!relTag.trim()) {
			err = "请填写版本号（tag）";
			return;
		}
		if (!lastUpload) {
			err = "请先选择并上传发行文件";
			return;
		}
		const j = await call("addRelease", {
			tag: relTag.trim(),
			name: relName.trim(),
			notes: relNotes,
			file: lastUpload.file,
			url: lastUpload.url,
			size: lastUpload.size,
			prerelease: relPrerelease
		});
		if (!j) return;
		relTag = "";
		relName = "";
		relNotes = "";
		relPrerelease = false;
		lastUpload = null;
		flash("发行已创建");
	}

	async function delRelease(id: string) {
		if (!confirm("删除这条发行记录？（不会删除已上传的文件）")) return;
		const j = await call("deleteRelease", { id });
		if (j) flash("已删除发行");
	}

	// ── Issues 管理 ──
	let adminIssues = $state<any[]>([]);
	let issueLoading = $state(false);
	async function loadIssues() {
		if (!slug) return;
		issueLoading = true;
		try {
			const res = await fetch(`/api/project-board/issues?slug=${encodeURIComponent(slug)}&state=all`);
			if (res.ok) adminIssues = (await res.json()).issues ?? [];
		} finally {
			issueLoading = false;
		}
	}

	async function issueAct(action: string, payload: Record<string, unknown>) {
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
				err = j.error || `失败（${res.status}）`;
				return;
			}
			await loadIssues();
		} finally {
			busy = false;
		}
	}
</script>

<div class="mb-6 flex flex-wrap items-center gap-3">
	<div>
		<h1 class="text-2xl font-heading font-semibold">项目展板</h1>
		<p class="text-sm text-muted-foreground">绑定仓库、维护进度与待办、发布发行版、管理站内 Issues。</p>
	</div>
	<div class="ml-auto flex flex-wrap items-center gap-2">
		<span
			class="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs {data.github.hasToken
				? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
				: 'border-amber-500/40 text-amber-600 dark:text-amber-400'}"
			title={data.github.hasToken ? "已配置 GITHUB_TOKEN" : "未配置 GITHUB_TOKEN，将按匿名配额 60 次/小时同步"}
		>
			<Github class="size-3.5" />
			{data.github.hasToken ? "GitHub 已授权" : "GitHub 匿名"}
		</span>
		<Button size="sm" variant="outline" disabled={busy} onclick={testGithub}>
			<Wifi class="size-3.5 mr-1" />测试连接
		</Button>
		<Button size="sm" variant="outline" disabled={busy} onclick={() => syncAll(false)}>
			<RefreshCw class="size-3.5 mr-1" />全部同步
		</Button>
		<Button size="sm" variant="outline" disabled={busy} onclick={() => syncAll(true)}>
			<RefreshCw class="size-3.5 mr-1" />全部同步（含发行）
		</Button>
	</div>
</div>

{#if err}
	<p class="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{err}</p>
{/if}
{#if msg}
	<p class="mb-4 rounded-md border border-border/60 bg-card p-3 text-sm">{msg}</p>
{/if}
{#if ghInfo}
	<p class="mb-4 rounded-md border border-border/60 bg-card p-3 text-xs text-muted-foreground">
		GitHub 连接：
		{#if ghInfo.ok}
			正常 · 身份 <strong class="text-foreground">{ghInfo.authenticated ? ghInfo.login : "匿名"}</strong> · 剩余配额
			<strong class="text-foreground">{ghInfo.remaining}/{ghInfo.limit}</strong>
			{#if ghInfo.resetAt} · 重置 {new Date(ghInfo.resetAt).toLocaleString("zh-CN")}{/if}
		{:else}
			<span class="text-destructive">{ghInfo.error}</span>
		{/if}
	</p>
{/if}

<div class="grid gap-6 lg:grid-cols-[240px_1fr]">
	<!-- 左：项目选择 -->
	<aside class="flex flex-col gap-1">
		<p class="mb-1 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">项目</p>
		{#each data.projects as p (p.slug)}
			{@const b = boards.find((x: any) => x.slug === p.slug)}
			<button
				type="button"
				class="flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors {slug === p.slug
					? 'bg-primary/15 text-primary'
					: 'hover:bg-muted/60'}"
				onclick={() => (slug = p.slug)}
			>
				<span class="min-w-0 flex-1 truncate">{p.title}</span>
				{#if b?.repo}
					<span class="size-1.5 shrink-0 rounded-full bg-emerald-500" title={b.repo}></span>
				{:else}
					<span class="size-1.5 shrink-0 rounded-full bg-muted-foreground/40" title="未绑定仓库"></span>
				{/if}
			</button>
		{/each}
		{#if data.projects.length === 0}
			<p class="px-2 py-4 text-sm text-muted-foreground">还没有项目。</p>
		{/if}
	</aside>

	<!-- 右：编辑区 -->
	{#if current}
		<div class="flex flex-col gap-5">
			<!-- 仓库绑定 -->
			<section class="rounded-xl border border-border/60 bg-card p-4">
				<div class="mb-3 flex items-center gap-2">
					<Link2 class="size-4 text-primary" />
					<h2 class="font-heading font-medium">仓库绑定</h2>
					{#if board?.sync?.error}
						<span class="ml-auto inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
							<AlertTriangle class="size-3" />上次同步失败
						</span>
					{/if}
				</div>
				<div class="flex flex-wrap items-center gap-2">
					<Input bind:value={repoInput} placeholder="owner/name 或 https://github.com/owner/name" class="h-9 min-w-[280px] flex-1" />
					<Button size="sm" disabled={busy} onclick={saveRepo}><Save class="size-3.5 mr-1" />保存</Button>
					<Button size="sm" variant="outline" disabled={busy || !repoInput.trim()} onclick={() => syncOne(false)}>
						<RefreshCw class="size-3.5 mr-1" />同步此项目
					</Button>
					<Button size="sm" variant="outline" disabled={busy || !repoInput.trim()} onclick={() => syncOne(true)}>
						<RefreshCw class="size-3.5 mr-1" />含发行
					</Button>
				</div>
				<div class="mt-2 flex flex-wrap items-center gap-2">
					<Input bind:value={tagline} placeholder="一句话标语（可选，覆盖 GitHub 简介）" class="h-8 max-w-md" />
				</div>

				{#if board?.sync}
					<div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/40 pt-3 text-xs text-muted-foreground">
						{#if board.sync.error}
							<span class="text-destructive">{board.sync.error}</span>
						{:else}
							<span class="inline-flex items-center gap-1"><Star class="size-3" />{board.sync.stars}</span>
							<span class="inline-flex items-center gap-1"><GitFork class="size-3" />{board.sync.forks}</span>
							<span class="inline-flex items-center gap-1"><GitCommitHorizontal class="size-3" />近一年 {board.sync.commitTotal} 次提交</span>
							<span class="inline-flex items-center gap-1"><CircleDot class="size-3" />{board.sync.openIssues} 个 GitHub Issue</span>
							{#if board.sync.language}<span>{board.sync.language}</span>{/if}
							{#if board.sync.truncated}<span class="text-amber-600 dark:text-amber-400">提交历史被截断（超过 1000 条）</span>{/if}
							<span class="ml-auto">同步于 {board.sync.at ? new Date(board.sync.at).toLocaleString("zh-CN") : "—"}</span>
						{/if}
					</div>
				{:else}
					<p class="mt-3 border-t border-border/40 pt-3 text-xs text-muted-foreground">尚未同步过。</p>
				{/if}
			</section>

			<!-- 待办 -->
			<section class="rounded-xl border border-border/60 bg-card p-4">
				<div class="mb-3 flex flex-wrap items-center gap-2">
					<CheckCircle2 class="size-4 text-primary" />
					<h2 class="font-heading font-medium">进度与待办</h2>
					<span class="text-xs text-muted-foreground">
						{todos.filter((t) => t.done).length} / {todos.length} 已完成
					</span>
					<Button size="sm" class="ml-auto" disabled={busy} onclick={saveTodos}><Save class="size-3.5 mr-1" />保存待办</Button>
				</div>

				<div class="mb-3 flex flex-wrap items-center gap-2">
					<Input bind:value={newTodo} placeholder="新待办项" class="h-8 max-w-xs" onkeydown={(e: KeyboardEvent) => e.key === "Enter" && addTodo()} />
					<Input bind:value={newTodoGroup} placeholder="分组（可选）" class="h-8 max-w-[140px]" />
					<Button size="sm" variant="outline" onclick={addTodo} disabled={!newTodo.trim()}><Plus class="size-3.5 mr-1" />添加</Button>
				</div>

				<div class="flex flex-col divide-y divide-border/40">
					{#if todos.length === 0}
						<p class="py-4 text-sm text-muted-foreground">暂无待办。</p>
					{/if}
					{#each todos as t, i (t.id)}
						<div class="flex flex-wrap items-center gap-2 py-2">
							<input type="checkbox" checked={t.done} onchange={(e) => (todos[i].done = (e.target as HTMLInputElement).checked)} class="size-4 accent-[var(--primary)]" />
							<Input bind:value={t.title} class="h-8 min-w-[160px] flex-1" />
							<Input bind:value={t.group} placeholder="分组" class="h-8 max-w-[120px]" />
							<Button variant="ghost" size="icon" class="h-8 w-8" disabled={i === 0} onclick={() => moveTodo(i, -1)}><ArrowUp class="size-3.5" /></Button>
							<Button variant="ghost" size="icon" class="h-8 w-8" disabled={i === todos.length - 1} onclick={() => moveTodo(i, 1)}><ArrowDown class="size-3.5" /></Button>
							<Button variant="ghost" size="icon" class="h-8 w-8 text-destructive hover:text-destructive" onclick={() => delTodo(i)}><Trash2 class="size-3.5" /></Button>
						</div>
					{/each}
				</div>
			</section>

			<!-- 里程碑 -->
			<section class="rounded-xl border border-border/60 bg-card p-4">
				<div class="mb-3 flex flex-wrap items-center gap-2">
					<Package class="size-4 text-primary" />
					<h2 class="font-heading font-medium">里程碑</h2>
					<Button size="sm" class="ml-auto" disabled={busy} onclick={saveMilestones}><Save class="size-3.5 mr-1" />保存里程碑</Button>
				</div>
				<div class="mb-3 flex flex-wrap items-center gap-2">
					<Input bind:value={newMs} placeholder="里程碑标题" class="h-8 max-w-xs" onkeydown={(e: KeyboardEvent) => e.key === "Enter" && addMs()} />
					<Button size="sm" variant="outline" onclick={addMs} disabled={!newMs.trim()}><Plus class="size-3.5 mr-1" />添加</Button>
				</div>
				<div class="flex flex-col divide-y divide-border/40">
					{#each milestones as m, i (m.id)}
						<div class="flex flex-wrap items-center gap-2 py-2">
							<input
								type="checkbox"
								checked={m.state === "done"}
								onchange={(e) => (milestones[i].state = (e.target as HTMLInputElement).checked ? "done" : "open")}
								class="size-4 accent-[var(--primary)]"
							/>
							<Input bind:value={m.title} class="h-8 min-w-[160px] flex-1" />
							<Input bind:value={m.due} placeholder="截止 2026-10-01" class="h-8 max-w-[150px]" />
							<Button variant="ghost" size="icon" class="h-8 w-8 text-destructive hover:text-destructive" onclick={() => (milestones = milestones.filter((_, idx) => idx !== i))}>
								<Trash2 class="size-3.5" />
							</Button>
						</div>
					{/each}
					{#if milestones.length === 0}
						<p class="py-3 text-sm text-muted-foreground">暂无里程碑。</p>
					{/if}
				</div>
			</section>

			<!-- 发行 -->
			<section class="rounded-xl border border-border/60 bg-card p-4">
				<div class="mb-3 flex items-center gap-2">
					<Upload class="size-4 text-primary" />
					<h2 class="font-heading font-medium">发行与下载</h2>
					<Badge variant="outline" class="ml-auto">{board?.releases?.length ?? 0}</Badge>
				</div>

				<div class="mb-4 grid gap-2 sm:grid-cols-2">
					<Input bind:value={relTag} placeholder="版本号 tag，如 v1.2.0" class="h-8" />
					<Input bind:value={relName} placeholder="显示名称（可选）" class="h-8" />
					<textarea
						bind:value={relNotes}
						rows="3"
						placeholder="更新说明（可选）"
						class="sm:col-span-2 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
					></textarea>
					<div class="flex flex-wrap items-center gap-2 sm:col-span-2">
						<label class="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1.5 text-xs transition-colors hover:border-primary/50">
							<Upload class="size-3.5" />
							{uploading ? "上传中…" : "选择发行文件"}
							<input type="file" class="hidden" onchange={pickFile} disabled={uploading} />
						</label>
						{#if lastUpload}
							<span class="text-xs text-muted-foreground">
								已就绪：<span class="font-mono">{lastUpload.file}</span>（{(lastUpload.size / 1024 / 1024).toFixed(1)} MB）
							</span>
						{/if}
						<label class="inline-flex items-center gap-1.5 text-xs">
							<input type="checkbox" bind:checked={relPrerelease} class="size-3.5 accent-[var(--primary)]" />预发布
						</label>
						<Button size="sm" class="ml-auto" disabled={busy || !relTag.trim() || !lastUpload} onclick={addRelease}>
							<Plus class="size-3.5 mr-1" />创建发行
						</Button>
					</div>
				</div>

				<div class="flex flex-col divide-y divide-border/40 border-t border-border/40">
					{#if !board?.releases?.length}
						<p class="py-4 text-sm text-muted-foreground">还没有发行记录。</p>
					{/if}
					{#each board?.releases ?? [] as r (r.id)}
						<div class="flex flex-wrap items-center gap-2 py-2 text-sm">
							<span class="rounded border border-border px-1.5 py-px font-mono text-[10px] text-muted-foreground">{r.tag}</span>
							<span class="min-w-0 flex-1 truncate">{r.name || r.tag}</span>
							{#if r.source === "github"}<Badge variant="outline">GitHub</Badge>{/if}
							<span class="text-xs text-muted-foreground">{r.downloads} 次下载</span>
							<a href={`/api/project-board/download?slug=${encodeURIComponent(slug)}&id=${encodeURIComponent(r.id)}`} class="text-xs text-primary hover:underline">测试下载</a>
							<Button variant="ghost" size="icon" class="h-7 w-7 text-destructive hover:text-destructive" onclick={() => delRelease(r.id)}><Trash2 class="size-3.5" /></Button>
						</div>
					{/each}
				</div>
			</section>

			<!-- Issues -->
			<section class="rounded-xl border border-border/60 bg-card p-4">
				<div class="mb-3 flex items-center gap-2">
					<CircleDot class="size-4 text-primary" />
					<h2 class="font-heading font-medium">站内 Issues</h2>
					<span class="text-xs text-muted-foreground">
						{adminIssues.filter((i) => i.state === "open").length} 打开 / {adminIssues.length} 总计
					</span>
					<Button size="sm" variant="outline" class="ml-auto" disabled={issueLoading} onclick={loadIssues}>
						<RefreshCw class="size-3.5 mr-1" />刷新
					</Button>
				</div>

				<div class="flex flex-col divide-y divide-border/40">
					{#if adminIssues.length === 0}
						<p class="py-4 text-sm text-muted-foreground">该项目还没有 Issue。</p>
					{/if}
					{#each adminIssues as it (it.id)}
						<div class="flex flex-wrap items-center gap-2 py-2 text-sm">
							<span class="shrink-0">
								{#if it.state === "open"}<CircleDot class="size-3.5 text-emerald-600 dark:text-emerald-400" />{:else}<CheckCircle2 class="size-3.5 text-muted-foreground" />{/if}
							</span>
							<span class="min-w-0 flex-1 truncate">
								<span class="text-muted-foreground">#{it.number}</span> {it.title}
							</span>
							{#each it.labels as l (l)}<Badge variant="outline">{l}</Badge>{/each}
							<span class="text-xs text-muted-foreground">{it.author}</span>
							<Button
								variant="ghost"
								size="sm"
								class="h-7 text-xs"
								disabled={busy}
								onclick={() => issueAct("state", { number: it.number, state: it.state === "open" ? "closed" : "open" })}
							>{it.state === "open" ? "关闭" : "重开"}</Button>
							<Button
								variant="ghost"
								size="icon"
								class="h-7 w-7 text-destructive hover:text-destructive"
								disabled={busy}
								onclick={() => confirm(`删除 #${it.number}？不可撤销。`) && issueAct("delete", { number: it.number })}
							><Trash2 class="size-3.5" /></Button>
						</div>
					{/each}
				</div>
			</section>
		</div>
	{:else}
		<p class="rounded-xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
			左侧还没有可配置的项目。
		</p>
	{/if}
</div>
