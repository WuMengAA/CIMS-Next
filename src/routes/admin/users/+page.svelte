<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "$lib/components/ui/table/index.js";
	import { Skeleton } from "$lib/components/ui/skeleton/index.js";
	import { Select } from "$lib/components/ui/select/index.js";
	import { createTable, tableFeatures, rowSortingFeature, createSortedRowModel, sortFn_alphanumeric } from "@tanstack/svelte-table";
	import type { SortingState } from "@tanstack/svelte-table";
	import { ArrowUpDown, Plus, Trash2, KeyRound, Users, Search } from "@lucide/svelte";
	import { toast } from "svelte-sonner";
	import { confirmDelete } from "$lib/components/admin/confirm.svelte";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	interface UserInfo { username: string; displayName: string; role: string; createdAt: string; }

	// 初始数据来自 load（导航期已取回），增删后仍走手动 load 刷新
	let users = $state<UserInfo[]>(data.users);
	let current = $state(data.current);
	let loading = $state(false);

	// New user form
	let newUsername = $state("");
	let newPassword = $state("");
	let newDisplay = $state("");
	let newRole = $state("editor");
	let showAddForm = $state(false);

	// Password change
	let pwdTarget = $state("");
	let newPwd = $state("");
	let showPwdForm = $state(false);

	// TanStack table state (v9: features registry + rune-backed controlled state)
	let sorting = $state<SortingState>([{ id: "createdAt", desc: true }]);
	let globalFilter = $state("");

	// v9 requires explicit feature registration; sorted row model rides along
	const features = tableFeatures({
		rowSortingFeature,
		sortedRowModel: createSortedRowModel(),
		sortFns: { alphanumeric: sortFn_alphanumeric }
	});

	const columns = [
		{ accessorKey: "displayName", id: "displayName" },
		{ accessorKey: "username", id: "username" },
		{ accessorKey: "role", id: "role" },
		{ accessorKey: "createdAt", id: "createdAt" },
		{ id: "actions", enableSorting: false }
	];

	const table = createTable({
		features,
		columns,
		get data() {
			const q = globalFilter.trim().toLowerCase();
			if (!q) return users;
			return users.filter(u =>
				[u.username, u.displayName, u.role].some(v => (v || "").toLowerCase().includes(q))
			);
		},
		state: {
			get sorting() {
				return sorting;
			}
		},
		onSortingChange: (updater) => {
			sorting = typeof updater === "function" ? updater(sorting) : updater;
		}
	});

	async function load() {
		loading = true;
		try {
			const res = await fetch("/api/auth");
			if (res.ok) {
				const data = await res.json();
				users = data.users || [];
				current = data.current || "";
			} else {
				toast.error("加载失败");
			}
		} catch {
			toast.error("网络错误");
		}
		loading = false;
	}

	async function addUser() {
		const res = await fetch("/api/auth", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "create_user", username: newUsername, password: newPassword, displayName: newDisplay, role: newRole })
		});
		const data = await res.json();
		if (data.ok) {
			toast.success("用户已创建");
			newUsername = ""; newPassword = ""; newDisplay = ""; showAddForm = false;
			load();
		} else {
			toast.error(data.error || "创建失败");
		}
	}

	async function removeUser(username: string) {
		if (!(await confirmDelete("删除用户 " + username, "该账号将无法再登录，此操作不可恢复。"))) return;
		const res = await fetch("/api/auth", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "delete_user", username })
		});
		const data = await res.json();
		if (data.ok) { toast.success("用户已删除"); load(); } else { toast.error(data.error || "删除失败"); }
	}

	async function changePwd() {
		const res = await fetch("/api/auth", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "change_password", username: pwdTarget, newPassword: newPwd })
		});
		const data = await res.json();
		if (data.ok) { toast.success("密码已修改"); newPwd = ""; showPwdForm = false; } else { toast.error(data.error || "修改失败"); }
	}

	// 初始数据来自 load；增删改密后手动调 load() 刷新
</script>

<div class="mb-6 flex items-center justify-between">
	<div>
		<h1 class="text-2xl font-heading font-semibold">用户管理</h1>
		<p class="text-sm text-muted-foreground">管理后台登录账号与角色权限</p>
	</div>
	<Button onclick={() => (showAddForm = !showAddForm)} variant="outline">
		<Plus class="h-4 w-4 mr-2" />
		添加用户
	</Button>
</div>

{#if showAddForm}
	<div class="mb-6 rounded-xl border border-border/60 bg-card p-5">
		<h3 class="mb-4 flex items-center gap-2 font-heading font-medium"><Users class="size-4" /> 新增用户</h3>
		<div class="grid gap-4 sm:grid-cols-2">
			<div class="grid gap-2"><Label>用户名</Label><Input bind:value={newUsername} placeholder="登录用户名" /></div>
			<div class="grid gap-2"><Label>显示名称</Label><Input bind:value={newDisplay} placeholder="昵称（可选）" /></div>
			<div class="grid gap-2"><Label>密码（至少 6 位）</Label><Input type="password" bind:value={newPassword} placeholder="密码" /></div>
			<div class="grid gap-2"><Label>角色</Label><Select.Root type="single" bind:value={newRole}>
				<Select.Trigger class="w-full">{({ editor: "编辑（editor）", admin: "管理员（admin）" })[newRole] ?? newRole}</Select.Trigger>
				<Select.Content>
					<Select.Item value="editor" label="编辑（editor）" />
					<Select.Item value="admin" label="管理员（admin）" />
				</Select.Content>
			</Select.Root></div>
		</div>
		<div class="mt-4"><Button onclick={addUser} disabled={!newUsername || !newPassword}>创建用户</Button></div>
	</div>
{/if}

{#if showPwdForm}
	<div class="mb-6 rounded-xl border border-border/60 bg-card p-5">
		<h3 class="mb-4 flex items-center gap-2 font-heading font-medium"><KeyRound class="size-4" /> 修改密码（{pwdTarget}）</h3>
		<div class="grid max-w-sm gap-2"><Label>新密码</Label><Input type="password" bind:value={newPwd} placeholder="新密码" /></div>
		<div class="mt-4 flex gap-2">
			<Button onclick={changePwd} disabled={!newPwd}>确认修改</Button>
			<Button variant="ghost" onclick={() => (showPwdForm = false)}>取消</Button>
		</div>
	</div>
{/if}

{#if loading}
	<div class="space-y-2" aria-label="加载中">
		{#each Array(3) as _, i (i)}
			<div class="flex items-center gap-3 rounded-lg border p-4">
				<div class="flex-1 space-y-2">
					<Skeleton class="h-4 w-1/4" />
					<Skeleton class="h-3 w-1/3" />
				</div>
				<Skeleton class="h-8 w-28 shrink-0" />
			</div>
		{/each}
	</div>
{:else}
	<div class="space-y-3">
		<div class="relative max-w-sm">
			<Search class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
			<Input bind:value={globalFilter} placeholder="搜索用户…" class="pl-9" />
		</div>

		<div class="overflow-x-auto rounded-xl border border-border/60">
			<Table>
				<TableHeader>
					{#each table.getHeaderGroups() as hg (hg.id)}
						<TableRow>
							{#each hg.headers as header (header.id)}
								<TableHead>
									{#if header.column.getCanSort()}
										<button
											class="flex items-center gap-1.5 hover:text-foreground"
											onclick={header.column.getToggleSortingHandler()}
										>
											{#if header.column.id === "displayName"}用户{:else if header.column.id === "username"}账号{:else if header.column.id === "role"}角色{:else if header.column.id === "createdAt"}创建时间{/if}
											<ArrowUpDown class="size-3.5 {header.column.getIsSorted() ? 'text-foreground' : 'text-muted-foreground/50'}" />
										</button>
									{/if}
								</TableHead>
							{/each}
						</TableRow>
					{/each}
				</TableHeader>
				<TableBody>
					{#each table.getRowModel().rows as row (row.id)}
						<TableRow>
							<TableCell>
								<div class="flex items-center gap-2">
									<span class="font-medium">{row.original.displayName || row.original.username}</span>
									{#if row.original.role === "admin"}
										<Badge>管理员</Badge>
									{:else}
										<Badge variant="outline">编辑</Badge>
									{/if}
									{#if row.original.username === current}
										<Badge variant="secondary">当前</Badge>
									{/if}
								</div>
							</TableCell>
							<TableCell class="text-muted-foreground">@{row.original.username}</TableCell>
							<TableCell class="text-muted-foreground">{row.original.role}</TableCell>
							<TableCell class="text-muted-foreground">{row.original.createdAt?.slice(0, 10)}</TableCell>
							<TableCell>
								<div class="flex items-center gap-1">
									<Button variant="outline" size="sm" onclick={() => { pwdTarget = row.original.username; newPwd = ""; showPwdForm = true; }}>
										<KeyRound class="h-3.5 w-3.5 mr-1" /> 改密码
									</Button>
									{#if row.original.username !== "admin"}
										<Button variant="ghost" size="sm" class="text-destructive hover:text-destructive" onclick={() => removeUser(row.original.username)}>
											<Trash2 class="h-3.5 w-3.5" />
										</Button>
									{/if}
								</div>
							</TableCell>
						</TableRow>
					{:else}
						<TableRow>
							<TableCell colspan={5} class="h-24 text-center text-muted-foreground">无匹配用户</TableCell>
						</TableRow>
					{/each}
				</TableBody>
			</Table>
		</div>
	</div>
{/if}
