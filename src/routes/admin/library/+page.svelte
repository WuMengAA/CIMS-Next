<script lang="ts">
	/** 附件库总览：谁占了多少、配额多少、要不要扩。操作全部二次确认，尤其是强制清理。 */
	import { enhance } from "$app/forms";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { confirmDelete } from "$lib/components/admin/confirm.svelte";
	import { formatBytes } from "$lib/storage-quota.js";
	import { HardDrive, AlertTriangle, Trash2, Plus } from "@lucide/svelte";

	type Row = import("./$types").PageData["rows"][number];
	let { data }: { data: import("./$types").PageData } = $props();

	let rows = $state<Row[]>(data.rows);
	let busy = $state<number | null>(null);
	let totalUsed = $derived(rows.reduce((s, r) => s + r.usedBytes, 0));
	let totalQuota = $derived(rows.reduce((s, r) => s + r.quotaBytes, 0));

	async function setBonus(r: Row) {
		const input = prompt(
			`给「${r.displayName}」追加额外配额（MiB）。\n留空或 0 = 撤销额外配额，只按经验等级计算。`,
			String(r.bonusBytes ? Math.round(r.bonusBytes / 1024 / 1024) : "")
		);
		if (input === null) return;
		busy = r.userId;
		const fd = new FormData();
		fd.set("userId", String(r.userId));
		fd.set("mib", String(Number(input) || 0));
		await fetch("", { method: "POST", body: fd });
		location.reload();
		busy = null;
	}

	async function purge(r: Row) {
		if (!(await confirmDelete(`清空「${r.displayName}」的全部附件`, `将从 R2 存储中删除全部 ${r.files} 个文件，不可恢复。`))) return;
		busy = r.userId;
		const res = await fetch(`/api/admin/library/purge`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ userId: r.userId })
		});
		const d = await res.json().catch(() => ({}));
		if (!res.ok) alert(d.error || "清理失败");
		else rows = rows.map((x) => (x.userId === r.userId ? { ...x, usedBytes: 0, files: 0, images: 0 } : x));
		busy = null;
	}
</script>

<div class="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-8">
	<div class="flex flex-wrap items-center gap-3">
		<HardDrive class="size-5 text-primary" />
		<h1 class="font-heading text-xl font-semibold">附件库 / 图床 管理</h1>
		<Badge variant={data.configured ? "default" : "destructive"}>
			{data.configured ? "Cloudflare R2 已接入" : "R2 未配置"}
		</Badge>
		<span class="ml-auto text-sm text-muted-foreground">
			总占用 {formatBytes(totalUsed)} / 配额合计 {formatBytes(totalQuota)}
		</span>
	</div>

	{#if !data.configured}
		<div class="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
			<AlertTriangle class="mt-0.5 size-4 shrink-0 text-amber-500" />
			<p>.env 里没有 R2_* 变量，任何人上传都会 503。配额数据仍会记账，但文件存不进去。</p>
		</div>
	{/if}

	<div class="overflow-x-auto rounded-xl border border-border/60">
		<table class="w-full text-sm">
			<thead class="bg-muted/50 text-xs text-muted-foreground">
				<tr>
					<th class="p-2 text-left">用户</th>
					<th class="p-2 text-left">角色</th>
					<th class="p-2 text-left">等级</th>
					<th class="p-2 text-left">占用</th>
					<th class="p-2 text-left">配额</th>
					<th class="p-2 text-right">操作</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as r (r.userId)}
					<tr class="border-t border-border/40">
						<td class="p-2">
							<div class="font-medium">{r.displayName}</div>
							<div class="text-xs text-muted-foreground">@{r.username} · {r.files} 个文件 / {r.images} 张图</div>
						</td>
						<td class="p-2"><Badge variant="outline">{r.role}</Badge></td>
						<td class="p-2">Lv.{r.level}</td>
						<td class="p-2">
							<div class="w-32 overflow-hidden rounded-full bg-muted">
								<div
									class="h-1.5 rounded-full {r.usedBytes / r.quotaBytes > 0.85 ? 'bg-amber-500' : 'bg-primary'}"
									style="width:{Math.min(100, Math.round((r.usedBytes / (r.quotaBytes || 1)) * 100))}%"
								></div>
							</div>
							<div class="mt-1 text-xs text-muted-foreground">{formatBytes(r.usedBytes)}</div>
						</td>
						<td class="p-2 text-muted-foreground">
							{formatBytes(r.quotaBytes)}
							{#if r.bonusBytes > 0}
								<div class="text-xs text-primary">含赠送 {formatBytes(r.bonusBytes)}</div>
							{/if}
						</td>
						<td class="flex justify-end gap-1 p-2">
							<Button variant="outline" size="sm" onclick={() => setBonus(r)} disabled={busy === r.userId}>
								<Plus class="mr-1 size-3.5" /> 调整配额
							</Button>
							<Button
								variant="ghost"
								size="sm"
								class="text-destructive"
								onclick={() => purge(r)}
								disabled={busy === r.userId || r.files === 0}
							>
								<Trash2 class="mr-1 size-3.5" /> 清空
							</Button>
						</td>
					</tr>
				{:else}
					<tr><td colspan="6" class="p-6 text-center text-muted-foreground">还没有账号</td></tr>
				{/each}
			</tbody>
		</table>
	</div>

	<p class="text-xs text-muted-foreground">
		个人空间容量 = 经验等级基数（Lv.1 100M → Lv.6 1000M 封顶，非线性）+ 管理员赠送额度。
		「赠送」可突破 1000M，是给运营成本点/活动留的口子，用完记得归零。
	</p>
</div>
