<script lang="ts">
	/**
	 * 更新日志后台管理页。
	 *
	 * 使用者是不懂技术的老师，所以这里有三条硬约束：
	 *   ① 界面上不出现任何英文技术词 —— 类型一律中文，状态只有「已发布 / 草稿」；
	 *   ② 每一次写操作都看 `res.ok`，失败必须把后端给的中文原因显示出来（假绿是红线）；
	 *   ③ 删除一律走统一确认对话框，不用浏览器原生 confirm。
	 *
	 * 数据靠客户端拉 /api/admin/changelog，不用 SSR load：列表会在同一页里被反复改，
	 * 每次写完重新拉一次 GET，界面就与实际落盘内容一致 —— 不靠本地乐观更新去「假装成功」。
	 */
	import { onMount } from "svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Textarea } from "$lib/components/ui/textarea/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { confirmDelete } from "$lib/components/admin/confirm.svelte";
	import { History, Plus, Trash2, Pencil, Check, X, Eye, EyeOff, RefreshCw } from "@lucide/svelte";
	import { toast } from "svelte-sonner";

	type Item = { kind: string; text: string };
	type Entry = {
		version: string;
		date: string;
		title: string;
		highlight?: string;
		items: Item[];
		published?: boolean;
	};

	// 条目类型只对外展示中文；kind 的取值不与任何标签文案耦合。
	const KIND_OPTIONS = [
		{ value: "feat", label: "新增" },
		{ value: "fix", label: "修复" },
		{ value: "change", label: "调整" },
		{ value: "chore", label: "其它" }
	];
	const KIND_LABELS: Record<string, string> = Object.fromEntries(KIND_OPTIONS.map((k) => [k.value, k.label]));
	const kindLabel = (kind: string) => KIND_LABELS[kind] ?? "其它";

	let list = $state<Entry[]>([]);
	let loading = $state(true);
	let loadError = $state("");
	let busy = $state(false);
	/** 页面级的成败横幅。失败是红色且常驻的 —— 弹一下就没了，老师会以为成功了。 */
	let feedback = $state<{ ok: boolean; text: string } | null>(null);

	const publishedCount = $derived(list.filter((e) => e.published !== false).length);
	const draftCount = $derived(list.length - publishedCount);

	// ── 表单状态 ────────────────────────────────────────────────────────────
	let showNew = $state(false);
	let nv = $state({ version: "", date: "", title: "", highlight: "" });

	let editVer = $state<string | null>(null);
	let ev = $state({ version: "", date: "", title: "", highlight: "" });

	let addFor = $state<string | null>(null);
	let newItem = $state({ kind: "feat", text: "" });

	let editItem = $state<{ version: string; index: number } | null>(null);
	let ei = $state({ kind: "feat", text: "" });

	function say(ok: boolean, text: string) {
		feedback = { ok, text };
		if (ok) toast.success(text);
		else toast.error(text);
	}

	async function load() {
		loading = true;
		loadError = "";
		try {
			const res = await fetch("/api/admin/changelog");
			if (!res.ok) {
				const d = await res.json().catch(() => ({}));
				loadError = d.error || `读取失败（错误代码 ${res.status}）`;
				list = [];
			} else {
				list = await res.json();
			}
		} catch {
			loadError = "网络连接失败，没能读到更新日志。";
		}
		loading = false;
	}

	onMount(load);

	/** 统一的写请求出口：只回布尔值，成败文案由调用方给。**失败一定不是绿的**。 */
	async function send(method: "POST" | "PUT" | "DELETE", payload: Record<string, unknown>): Promise<boolean> {
		busy = true;
		feedback = null;
		try {
			const res = await fetch("/api/admin/changelog", {
				method,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload)
			});
			const d = await res.json().catch(() => ({}));
			if (!res.ok) {
				say(false, d.error || `操作失败（错误代码 ${res.status}），请稍后重试`);
				return false;
			}
			return true;
		} catch {
			say(false, "网络错误，这次修改没有保存成功，请重试。");
			return false;
		} finally {
			busy = false;
		}
	}

	// ── 新建版本 ────────────────────────────────────────────────────────────
	async function createVersion() {
		if (!nv.version.trim() || !nv.date.trim()) {
			say(false, "版本号和发布日期都要填写。");
			return;
		}
		const ok = await send("POST", {
			version: nv.version.trim(),
			date: nv.date.trim(),
			title: nv.title.trim(),
			highlight: nv.highlight.trim()
		});
		if (!ok) return;
		say(true, `已创建版本 ${nv.version.trim()}，目前是草稿，点「发布」后才会显示在前台。`);
		showNew = false;
		nv = { version: "", date: "", title: "", highlight: "" };
		await load();
	}

	// ── 发布状态切换 ────────────────────────────────────────────────────────
	async function togglePublished(e: Entry) {
		const next = e.published === false;
		const ok = await send("PUT", { version: e.version, published: next });
		if (!ok) return;
		say(true, next ? `版本 ${e.version} 已转为草稿，前台不再显示。` : `版本 ${e.version} 已发布，现在前台能看到。`);
		await load();
	}

	// ── 版本信息 ────────────────────────────────────────────────────────────
	function startEditVersion(e: Entry) {
		editVer = e.version;
		ev = { version: e.version, date: e.date, title: e.title, highlight: e.highlight ?? "" };
		addFor = null;
		editItem = null;
		showNew = false;
	}

	async function saveVersion() {
		if (!editVer) return;
		if (!ev.version.trim() || !ev.date.trim()) {
			say(false, "版本号和发布日期都不能为空。");
			return;
		}
		const ok = await send("PUT", {
			version: editVer,
			newVersion: ev.version.trim(),
			date: ev.date.trim(),
			title: ev.title.trim(),
			highlight: ev.highlight.trim()
		});
		if (!ok) return;
		say(true, "版本信息已保存。");
		editVer = null;
		await load();
	}

	async function removeVersion(e: Entry) {
		const n = e.items.length;
		if (!(await confirmDelete(`删除版本 ${e.version}`, `删除后这个版本的 ${n} 条记录会一起消失，不可恢复。`))) return;
		const ok = await send("DELETE", { version: e.version });
		if (!ok) return;
		say(true, `已删除版本 ${e.version}。`);
		editVer = null;
		await load();
	}

	// ── 条目 ────────────────────────────────────────────────────────────────
	async function addItem(e: Entry) {
		if (!newItem.text.trim()) {
			say(false, "请先写这一条的内容再点确定。");
			return;
		}
		const ok = await send("PUT", {
			version: e.version,
			items: [...e.items, { kind: newItem.kind, text: newItem.text.trim() }]
		});
		if (!ok) return;
		say(true, "已添加一条记录。");
		addFor = null;
		newItem = { kind: "feat", text: "" };
		await load();
	}

	function startEditItem(version: string, index: number, item: Item) {
		editItem = { version, index };
		ei = { kind: item.kind, text: item.text };
		addFor = null;
	}

	async function saveItem() {
		if (!editItem) return;
		const e = list.find((x) => x.version === editItem!.version);
		if (!e) return;
		if (!ei.text.trim()) {
			say(false, "内容不能为空，要删掉这条请点「删除」。");
			return;
		}
		const items = e.items.map((it, i) => (i === editItem!.index ? { kind: ei.kind, text: ei.text.trim() } : it));
		const ok = await send("PUT", { version: e.version, items });
		if (!ok) return;
		say(true, "这条记录已更新。");
		editItem = null;
		await load();
	}

	async function removeItem(e: Entry, index: number) {
		if (!(await confirmDelete("删除这条记录", "删除后无法恢复。"))) return;
		const items = e.items.filter((_, i) => i !== index);
		const ok = await send("PUT", { version: e.version, items });
		if (!ok) return;
		say(true, "已删除这条记录。");
		editItem = null;
		await load();
	}
</script>

<svelte:head>
	<title>更新日志管理 | Stelarith</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-8">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div class="flex items-start gap-2">
			<History class="mt-1 size-5 shrink-0 text-primary" />
			<div>
				<h1 class="font-heading text-xl font-semibold">更新日志</h1>
				<p class="mt-1 text-sm text-muted-foreground">
					已发布的会显示在网站的更新日志页面；草稿只有你自己能看到。
				</p>
			</div>
		</div>
		<Button onclick={() => { showNew = !showNew; editVer = null; }}>
			<Plus class="mr-1 size-4" />新建版本
		</Button>
	</div>

	{#if list.length > 0}
		<p class="text-sm text-muted-foreground">
			共 {list.length} 个版本，其中 {publishedCount} 个已发布、{draftCount} 个草稿。
		</p>
	{/if}

	{#if feedback}
		<div
			class="rounded-lg border p-3 text-sm {feedback.ok
				? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
				: 'border-destructive/50 bg-destructive/10 text-destructive'}"
		>
			{feedback.text}
		</div>
	{/if}

	{#if showNew}
		<div class="rounded-xl border border-border/60 bg-card p-4">
			<div class="grid gap-3 sm:grid-cols-2">
				<div class="grid gap-1.5">
					<label class="text-sm font-medium" for="nv-version">版本号</label>
					<Input id="nv-version" bind:value={nv.version} placeholder="2026.09.27" disabled={busy} />
				</div>
				<div class="grid gap-1.5">
					<label class="text-sm font-medium" for="nv-date">发布日期</label>
					<Input id="nv-date" bind:value={nv.date} placeholder="2026-09-27" disabled={busy} />
				</div>
				<div class="grid gap-1.5">
					<label class="text-sm font-medium" for="nv-title">标题</label>
					<Input id="nv-title" bind:value={nv.title} placeholder="这一版做了什么" disabled={busy} />
				</div>
				<div class="grid gap-1.5">
					<label class="text-sm font-medium" for="nv-highlight">高亮语</label>
					<Input id="nv-highlight" bind:value={nv.highlight} placeholder="一句话概括这一版（可留空）" disabled={busy} />
				</div>
			</div>
			<p class="mt-2 text-xs text-muted-foreground">新建后默认是草稿，不会显示在前台。</p>
			<div class="mt-3 flex justify-end gap-2">
				<Button variant="ghost" disabled={busy} onclick={() => (showNew = false)}>取消</Button>
				<Button disabled={busy} onclick={createVersion}>{busy ? "保存中…" : "创建版本"}</Button>
			</div>
		</div>
	{/if}

	{#if loading}
		<div class="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">正在读取更新日志…</div>
	{:else if loadError}
		<div class="flex flex-col items-center gap-3 rounded-xl border border-destructive/50 bg-destructive/5 p-10 text-center">
			<p class="text-sm text-destructive">{loadError}</p>
			<Button variant="outline" disabled={busy} onclick={load}><RefreshCw class="mr-1 size-4" />重试</Button>
		</div>
	{:else if list.length === 0}
		<div class="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
			还没有更新记录，点右上角的「新建版本」写第一条。
		</div>
	{:else}
		<div class="flex flex-col gap-4">
			{#each list as e (e.version)}
				<div class="rounded-xl border border-border/60 bg-card p-4">
					{#if editVer === e.version}
						<!-- 编辑版本信息 -->
						<div class="grid gap-3 sm:grid-cols-2">
							<div class="grid gap-1.5">
								<label class="text-sm font-medium" for="ev-version">版本号</label>
								<Input id="ev-version" bind:value={ev.version} disabled={busy} />
							</div>
							<div class="grid gap-1.5">
								<label class="text-sm font-medium" for="ev-date">发布日期</label>
								<Input id="ev-date" bind:value={ev.date} placeholder="2026-09-27" disabled={busy} />
							</div>
							<div class="grid gap-1.5">
								<label class="text-sm font-medium" for="ev-title">标题</label>
								<Input id="ev-title" bind:value={ev.title} disabled={busy} />
							</div>
							<div class="grid gap-1.5">
								<label class="text-sm font-medium" for="ev-highlight">高亮语</label>
								<Input id="ev-highlight" bind:value={ev.highlight} placeholder="一句话概括这一版（可留空）" disabled={busy} />
							</div>
						</div>
						<div class="mt-3 flex justify-end gap-2">
							<Button variant="ghost" disabled={busy} onclick={() => (editVer = null)}>取消</Button>
							<Button disabled={busy} onclick={saveVersion}><Check class="mr-1 size-4" />{busy ? "保存中…" : "保存"}</Button>
						</div>
					{:else}
						<div class="flex flex-wrap items-start justify-between gap-3">
							<div class="min-w-0">
								<div class="flex flex-wrap items-center gap-2">
									<span class="font-heading text-base font-semibold">{e.version}</span>
									<span class="text-xs text-muted-foreground">{e.date}</span>
									<Badge variant={e.published === false ? "secondary" : "default"}>
										{e.published === false ? "草稿" : "已发布"}
									</Badge>
									<Badge variant="outline" class="text-[10px]">{e.items.length} 条记录</Badge>
								</div>
								{#if e.title}
									<p class="mt-1 text-sm font-medium">{e.title}</p>
								{/if}
								{#if e.highlight}
									<p class="mt-0.5 text-sm text-muted-foreground">{e.highlight}</p>
								{/if}
							</div>
							<div class="flex shrink-0 flex-wrap items-center gap-1.5">
								<Button size="sm" variant="outline" disabled={busy} onclick={() => togglePublished(e)}>
									{#if e.published === false}
										<Eye class="mr-1 size-3.5" />发布
									{:else}
										<EyeOff class="mr-1 size-3.5" />转为草稿
									{/if}
								</Button>
								<Button size="sm" variant="outline" disabled={busy} onclick={() => startEditVersion(e)}>
									<Pencil class="mr-1 size-3.5" />编辑版本信息
								</Button>
								<Button
									size="sm"
									variant="ghost"
									class="text-destructive hover:text-destructive"
									disabled={busy}
									onclick={() => removeVersion(e)}
								>
									<Trash2 class="mr-1 size-3.5" />删除版本
								</Button>
							</div>
						</div>

						<!-- 条目列表 -->
						<div class="mt-3 flex flex-col gap-2">
							{#each e.items as item, index (index)}
								{#if editItem && editItem.version === e.version && editItem.index === index}
									<div class="rounded-lg border border-border/60 bg-muted/30 p-3">
										<div class="flex flex-col gap-2 sm:flex-row">
											<select
												class="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
												bind:value={ei.kind}
												disabled={busy}
											>
												{#each KIND_OPTIONS as k (k.value)}
													<option value={k.value}>{k.label}</option>
												{/each}
											</select>
											<Textarea class="min-h-16 flex-1" bind:value={ei.text} rows={2} disabled={busy} />
										</div>
										<div class="mt-2 flex justify-end gap-2">
											<Button size="sm" variant="ghost" disabled={busy} onclick={() => (editItem = null)}>
												<X class="mr-1 size-3.5" />取消
											</Button>
											<Button size="sm" disabled={busy} onclick={saveItem}>
												<Check class="mr-1 size-3.5" />{busy ? "保存中…" : "保存"}
											</Button>
										</div>
									</div>
								{:else}
									<div class="flex items-start gap-2 rounded-lg px-1 py-1">
										<Badge variant="outline" class="mt-0.5 shrink-0">{kindLabel(item.kind)}</Badge>
										<p class="min-w-0 flex-1 text-sm">{item.text}</p>
										<div class="flex shrink-0 items-center gap-1">
											<Button size="icon-sm" variant="ghost" disabled={busy} onclick={() => startEditItem(e.version, index, item)}>
												<Pencil class="size-3.5" />
											</Button>
											<Button
												size="icon-sm"
												variant="ghost"
												class="text-destructive hover:text-destructive"
												disabled={busy}
												onclick={() => removeItem(e, index)}
											>
												<Trash2 class="size-3.5" />
											</Button>
										</div>
									</div>
								{/if}
							{/each}
						</div>

						<!-- 添加一条 -->
						<div class="mt-3 border-t border-border/60 pt-3">
							{#if addFor === e.version}
								<div class="flex flex-col gap-2 sm:flex-row">
									<select
										class="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
										bind:value={newItem.kind}
										disabled={busy}
									>
										{#each KIND_OPTIONS as k (k.value)}
											<option value={k.value}>{k.label}</option>
										{/each}
									</select>
									<Textarea class="min-h-16 flex-1" bind:value={newItem.text} rows={2} placeholder="这一条写了什么改动？" disabled={busy} />
								</div>
								<div class="mt-2 flex justify-end gap-2">
									<Button size="sm" variant="ghost" disabled={busy} onclick={() => (addFor = null)}>取消</Button>
									<Button size="sm" disabled={busy} onclick={() => addItem(e)}>
										<Check class="mr-1 size-3.5" />{busy ? "保存中…" : "确定"}
									</Button>
								</div>
							{:else}
								<Button
									size="sm"
									variant="outline"
									disabled={busy}
									onclick={() => { addFor = e.version; editItem = null; newItem = { kind: "feat", text: "" }; }}
								>
									<Plus class="mr-1 size-3.5" />添加一条
								</Button>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
