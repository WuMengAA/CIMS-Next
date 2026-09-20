<script lang="ts">
	/**
	 * 称号管理：为单个用户独立追加 / 撤回称号（权限的最小可操作单元）。
	 *
	 * 权限模型核心：等级只是显示秩位，**称号才是权限载体**。这里让管理员把某个用户的
	 * 称号集合覆盖写（空数组 = 回退到其角色预设），实现「即便角色是 X，也能单独给他 Y 能力」
	 * 或「即便角色是 Y，也能单独收回某能力」——与等级完全解耦。
	 */
	import { onMount } from "svelte";
	import { ShieldPlus, Check, Save, RotateCcw } from "@lucide/svelte";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import type { TitleKey } from "$lib/permissions.js";

	type TitleMeta = { key: TitleKey; label: string; description: string };
	type Row = {
		username: string;
		role: string;
		titles: TitleKey[];
		titleLabels: string[];
		hasOverride: boolean;
	};

	let allTitles: TitleMeta[] = [];
	let rows: Row[] = [];
	let loaded = $state(false);
	let savingUser = $state<string | null>(null);
	let statusMsg = $state("");

	// 每个用户「当前编辑态」的副本（勾选框绑定到这里）
	let draft = $state<Record<string, Set<TitleKey>>>({});

	async function load() {
		loaded = false;
		try {
			const r = await fetch("/api/users/titles");
			const data = await r.json();
			rows = data.users ?? [];
			allTitles = data.allTitles ?? (data.users?.[0]?.allTitles ?? []);
			draft = {};
			for (const u of rows) draft[u.username] = new Set(u.titles);
		} catch (e) {
			statusMsg = "加载失败：" + String(e);
		} finally {
			loaded = true;
		}
	}

	function toggle(username: string, t: TitleKey) {
		const s = draft[username] ?? new Set<TitleKey>();
		if (s.has(t)) s.delete(t);
		else s.add(t);
		// 触发响应式更新
		draft = { ...draft, [username]: new Set(s) };
	}

	async function save(username: string) {
		savingUser = username;
		statusMsg = "";
		try {
			const titles = Array.from(draft[username] ?? []);
			const r = await fetch("/api/users/titles", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ username, titles })
			});
			const data = await r.json();
			if (!r.ok || !data.ok) {
				statusMsg = `保存 ${username} 失败：${data.error ?? r.status}`;
			} else {
				statusMsg = `已保存 ${username} 的称号：${data.titleLabels.join(" / ") || "（空，回退角色预设）"}`;
				// 同步本地行
				const row = rows.find((x) => x.username === username);
				if (row) {
					row.titles = data.titles;
					row.titleLabels = data.titleLabels;
					row.hasOverride = data.hasOverride;
				}
			}
		} catch (e) {
			statusMsg = "保存失败：" + String(e);
		} finally {
			savingUser = null;
		}
	}

	onMount(load);
</script>

<div class="mb-6">
	<h1 class="flex items-center gap-2 font-heading text-2xl font-semibetracking-tight">
		<ShieldPlus class="size-6 text-primary" /> 称号管理
	</h1>
	<p class="mt-1 text-sm text-muted-foreground">
	<p class="mt-1 text-sm text-muted-foreground">
		等级只是显示秩位，<b class="text-foreground">称号才是权限载体</b>。这里可为每个用户独立追加 / 撤回称号——
		勾选即授予、取消即收回，覆盖写其角色预设。空集合表示「回退到角色默认称号」。
	</p>
</div>

{#if statusMsg}
	<div class="mb-4 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm">{statusMsg}</div>
{/if}

{#if !loaded}
	<p class="text-sm text-muted-foreground">加载中…</p>
{:else if rows.length === 0}
	<p class="text-sm text-muted-foreground">暂无用户。</p>
{:else}
	<div class="space-y-4">
		{#each rows as u (u.username)}
			<div class="rounded-xl border border-border/60 p-4">
				<div class="mb-3 flex flex-wrap items-center gap-2">
					<b class="font-medium">{u.username}</b>
					<Badge variant="outline">{u.role}</Badge>
					{#if u.hasOverride}
						<Badge variant="default" class="text-[10px]">已覆盖角色预设</Badge>
					{:else}
						<span class="text-xs text-muted-foreground">跟随角色预设</span>
					{/if}
				</div>
				<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{#each allTitles as t (t.key)}
						<label class="flex items-start gap-2 rounded-lg border border-border/50 px-3 py-2 text-sm">
							<input
								type="checkbox"
								class="mt-0.5"
								checked={draft[u.username]?.has(t.key) ?? false}
								onchange={() => toggle(u.username, t.key)}
							/>
							<span>
								<span class="font-medium">{t.label}</span>
								<span class="block text-xs text-muted-foreground">{t.description}</span>
							</span>
						</label>
					{/each}
				</div>
				<div class="mt-3 flex gap-2">
					<button
						class="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
						onclick={() => save(u.username)}
						disabled={savingUser === u.username}
					>
						<Save class="size-3.5" /> {savingUser === u.username ? "保存中…" : "保存"}
					</button>
					<button
						class="inline-flex items-center gap-1 rounded-md border border-border/60 px-3 py-1.5 text-sm disabled:opacity-50"
						onclick={() => (draft = { ...draft, [u.username]: new Set(u.titles) })}
					>
						<RotateCcw class="size-3.5" /> 还原
					</button>
				</div>
			</div>
		{/each}
	</div>
{/if}
