<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Textarea } from "$lib/components/ui/textarea/index.js";
	import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "$lib/components/ui/table/index.js";
	import { Skeleton } from "$lib/components/ui/skeleton/index.js";
	import * as Select from "$lib/components/ui/select/index.js";
	import { createTable, tableFeatures, rowSortingFeature, createSortedRowModel, sortFn_alphanumeric } from "@tanstack/svelte-table";
	import type { SortingState } from "@tanstack/svelte-table";
	import { ArrowUpDown, Plus, Trash2, KeyRound, Users, Search, Pencil, ShieldOff, Circle, X, Check } from "@lucide/svelte";
	import { toast } from "svelte-sonner";
	import { confirmDelete } from "$lib/components/admin/confirm.svelte";
	import { ROLE_LABELS, type Role } from "$lib/permissions.js";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	interface UserInfo {
		username: string; displayName: string; email?: string; bio?: string; avatar?: string;
		role: string; status?: string; verified?: boolean; createdAt: string;
		lastLoginAt?: string | null; lastLoginIp?: string | null; loginCount?: number;
		sessionCount?: number; lastSeenAt?: string | null; online?: boolean; activityCount?: number;
	}

	let users = $state<UserInfo[]>(data.users as UserInfo[]);
	let current = $state(data.current);
	let loading = $state(false);

	// New user form
	let newUsername = $state("");
	let newPassword = $state("");
	let newDisplay = $state("");
	let newEmail = $state("");
	let newRole = $state("editor");
	let showAddForm = $state(false);

	// Edit form
	let editTarget = $state<UserInfo | null>(null);
	let editDisplay = $state("");
	let editEmail = $state("");
	let editBio = $state("");
	let editRole = $state("user");
	let editStatus = $state("active");

	// Password change
	let pwdTarget = $state("");
	let newPwd = $state("");
	let showPwdForm = $state(false);

	// TanStack table
	let sorting = $state<SortingState>([{ id: "createdAt", desc: true }]);
	let globalFilter = $state("");

	const features = tableFeatures({
		rowSortingFeature,
		sortedRowModel: createSortedRowModel(),
		sortFns: { alphanumeric: sortFn_alphanumeric }
	});

	const columns = [
		{ accessorKey: "displayName", id: "displayName" },
		{ accessorKey: "username", id: "username" },
		{ accessorKey: "role", id: "role" },
		{ accessorKey: "status", id: "status" },
		{ accessorKey: "lastLoginAt", id: "lastLoginAt" },
		{ accessorKey: "createdAt", id: "createdAt" },
		{ id: "actions", enableSorting: false }
	];

	const table = createTable({
		features,
		columns,
		get data() {
			const q = globalFilter.trim().toLowerCase();
			if (!q) return users;
			return users.filter((u) =>
				[u.username, u.displayName, u.email, u.role].some((v) => (v || "").toLowerCase().includes(q))
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
				const d = await res.json();
				users = d.users || [];
				current = d.current || "";
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
			body: JSON.stringify({ action: "create_user", username: newUsername, password: newPassword, displayName: newDisplay, email: newEmail, role: newRole })
		});
		const d = await res.json();
		if (d.ok) {
			toast.success("用户已创建");
			newUsername = ""; newPassword = ""; newDisplay = ""; newEmail = ""; showAddForm = false;
			load();
		} else {
			toast.error(d.error || "创建失败");
		}
	}

	function openEdit(u: UserInfo) {
		editTarget = u;
		editDisplay = u.displayName || "";
		editEmail = u.email || "";
		editBio = u.bio || "";
		editRole = u.role;
		editStatus = u.status || "active";
	}

	async function saveEdit() {
		if (!editTarget) return;
		const res = await fetch("/api/auth", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				action: "update_user", username: editTarget.username,
				displayName: editDisplay, email: editEmail, bio: editBio, role: editRole, status: editStatus
			})
		});
		const d = await res.json();
		if (d.ok) { toast.success("已保存"); editTarget = null; load(); }
		else toast.error(d.error || "保存失败");
	}

	async function approveUser(username: string) {
		const res = await fetch("/api/auth", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "update_user", username, status: "active" })
		});
		const d = await res.json();
		if (d.ok) { toast.success(`已批准 ${username}，账号已激活`); load(); }
		else toast.error(d.error || "批准失败");
	}

	async function removeUser(username: string) {
		if (!(await confirmDelete("删除用户 " + username, "该账号及其会话将一并删除，此操作不可恢复。"))) return;
		const res = await fetch("/api/auth", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "delete_user", username })
		});
		const d = await res.json();
		if (d.ok) { toast.success("用户已删除"); load(); } else { toast.error(d.error || "删除失败"); }
	}

	async function revokeSessions(username: string) {
		const res = await fetch("/api/users", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "revoke_sessions", username })
		});
		const d = await res.json();
		if (d.ok) { toast.success(`已吊销 ${d.revoked} 个会话`); load(); } else { toast.error(d.error || "操作失败"); }
	}

	async function changePwd() {
		const res = await fetch("/api/auth", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "change_password", username: pwdTarget, newPassword: newPwd })
		});
		const d = await res.json();
		if (d.ok) { toast.success("密码已修改"); newPwd = ""; showPwdForm = false; } else { toast.error(d.error || "修改失败"); }
	}

	function shortTime(iso?: string | null): string {
		if (!iso) return "—";
		const t = Date.parse(iso);
		if (!Number.isFinite(t)) return iso.slice(0, 10);
		const d = new Date(t);
		return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
	}

	const ROLE_OPTIONS: Role[] = ["user", "moderator", "editor", "techrep", "viewer", "admin"];
</script>

<div class="mb-6 flex items-center justify-between">
	<div>
		<h1 class="font-heading text-2xl font-semibold tracking-tight">用户管理</h1>
		<p class="text-sm text-muted-foreground">多用户账号、角色权限、在线状态与资料</p>
	</div>
	<Button onclick={() => (showAddForm = !showAddForm)} variant="outline">
		<Plus class="mr-2 h-4 w-4" />
		添加用户
	</Button>
</div>

{#if showAddForm}
	<div class="mb-6 rounded-xl border border-border/60 bg-card p-5">
		<h3 class="mb-4 flex items-center gap-2 font-heading font-medium"><Users class="size-4" /> 新增用户</h3>
		<div class="grid gap-4 sm:grid-cols-2">
			<div class="grid gap-2"><Label>用户名</Label><Input bind:value={newUsername} placeholder="登录用户名" /></div>
			<div class="grid gap-2"><Label>显示名称</Label><Input bind:value={newDisplay} placeholder="昵称（可选）" /></div>
			<div class="grid gap-2"><Label>邮箱</Label><Input bind:value={newEmail} placeholder="邮箱（可选）" /></div>
			<div class="grid gap-2"><Label>密码（至少 6 位）</Label><Input type="password" bind:value={newPassword} placeholder="密码" /></div>
			<div class="grid gap-2"><Label>角色</Label><Select.Root type="single" bind:value={newRole}>
				<Select.Trigger class="w-full">{ROLE_LABELS[newRole as Role] || newRole}</Select.Trigger>
				<Select.Content>
					{#each ROLE_OPTIONS as r (r)}
						<Select.Item value={r} label={ROLE_LABELS[r]} />
					{/each}
				</Select.Content>
			</Select.Root></div>
		</div>
		<div class="mt-4"><Button onclick={addUser} disabled={!newUsername || !newPassword}>创建用户</Button></div>
	</div>
{/if}

{#if editTarget}
	<div class="mb-6 rounded-xl border border-border/60 bg-card p-5">
		<div class="mb-4 flex items-center justify-between">
			<h3 class="flex items-center gap-2 font-heading font-medium"><Pencil class="size-4" /> 编辑用户 · {editTarget.username}</h3>
			<Button variant="ghost" size="sm" onclick={() => (editTarget = null)}><X class="size-4" /></Button>
		</div>
		<div class="grid gap-4 sm:grid-cols-2">
			<div class="grid gap-2"><Label>显示名称</Label><Input bind:value={editDisplay} /></div>
			<div class="grid gap-2"><Label>邮箱</Label><Input bind:value={editEmail} /></div>
			<div class="grid gap-2"><Label>角色</Label><Select.Root type="single" bind:value={editRole}>
				<Select.Trigger class="w-full">{ROLE_LABELS[editRole as Role] || editRole}</Select.Trigger>
				<Select.Content>
					{#each ROLE_OPTIONS as r (r)}
						<Select.Item value={r} label={ROLE_LABELS[r]} />
					{/each}
				</Select.Content>
			</Select.Root></div>
			<div class="grid gap-2"><Label>状态</Label><Select.Root type="single" bind:value={editStatus}>
				<Select.Trigger class="w-full">{editStatus === "active" ? "正常" : "已停用"}</Select.Trigger>
				<Select.Content>
					<Select.Item value="active" label="正常" />
					<Select.Item value="disabled" label="已停用" />
				</Select.Content>
			</Select.Root></div>
			<div class="grid gap-2 sm:col-span-2"><Label>个人简介</Label><Textarea bind:value={editBio} rows={3} placeholder="一句话介绍…" /></div>
		</div>
		<div class="mt-4 flex gap-2">
			<Button onclick={saveEdit}>保存</Button>
			<Button variant="ghost" onclick={() => (editTarget = null)}>取消</Button>
		</div>
	</div>
{/if}

{#if showPwdForm}
	<div class="mb-6 rounded-xl border border-border/60 bg-card p-5">
		<h3 class="mb-4 flex items-center gap-2 font-heading font-medium"><KeyRound class="size-4" /> 修改密码（{pwdTarget}）</h3>
		<div class="grid max-w-sm gap-2"><Label>新密码</Label><Input type="password" bind:value={newPwd} placeholder="新密码" /></div>
		<p class="mt-2 text-xs text-muted-foreground">修改后该用户所有登录会话将被吊销，需重新登录。</p>
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
											{#if header.column.id === "displayName"}用户{:else if header.column.id === "username"}账号{:else if header.column.id === "role"}角色{:else if header.column.id === "status"}状态{:else if header.column.id === "lastLoginAt"}最后登录{:else if header.column.id === "createdAt"}创建时间{/if}
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
						{@const u = row.original}
						<TableRow>
							<TableCell>
								<div class="flex items-center gap-2">
									<span class="relative flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-medium text-primary">
										{u.displayName?.slice(0, 1) || u.username.slice(0, 1)}
										{#if u.online}
											<Circle class="absolute -bottom-0.5 -right-0.5 size-2.5 fill-emerald-400 text-emerald-400" />
										{/if}
									</span>
									<div class="flex min-w-0 flex-col">
										<div class="flex items-center gap-2">
											<span class="truncate font-medium">{u.displayName || u.username}</span>
											<Badge variant={u.role === "admin" ? "default" : "outline"}>{ROLE_LABELS[u.role as Role] || u.role}</Badge>
											{#if u.username === current}<Badge variant="secondary">当前</Badge>{/if}
											{#if u.online}<span class="text-[11px] text-emerald-400">在线</span>{/if}
										</div>
										{#if u.email}<span class="truncate text-xs text-muted-foreground">{u.email}</span>{/if}
									</div>
								</div>
							</TableCell>
							<TableCell class="text-muted-foreground">@{u.username}</TableCell>
							<TableCell class="text-muted-foreground">{u.role}</TableCell>
							<TableCell>
								{#if (u.status || "active") === "active"}
									<Badge variant="outline">正常</Badge>
								{:else if u.status === "pending"}
									<Badge variant="secondary" class="border-amber-500/40 bg-amber-500/15 text-amber-600">待验证</Badge>
								{:else}
									<Badge variant="destructive">已停用</Badge>
								{/if}
							</TableCell>
							<TableCell class="text-muted-foreground">
								<div class="flex flex-col leading-tight">
									<span>{shortTime(u.lastLoginAt)}</span>
									<span class="text-[11px] text-muted-foreground/70">共 {u.loginCount ?? 0} 次 · {u.sessionCount ?? 0} 会话</span>
								</div>
							</TableCell>
							<TableCell class="text-muted-foreground">{u.createdAt?.slice(0, 10)}</TableCell>
							<TableCell>
								<div class="flex items-center gap-1">
									{#if u.status === "pending"}
										<Button variant="default" size="sm" onclick={() => approveUser(u.username)} title="批准并激活该账号">
											<Check class="mr-1 h-3.5 w-3.5" /> 批准
										</Button>
									{/if}
									<Button variant="outline" size="sm" onclick={() => openEdit(u)}>
										<Pencil class="mr-1 h-3.5 w-3.5" /> 编辑
									</Button>
									<Button variant="outline" size="sm" onclick={() => { pwdTarget = u.username; newPwd = ""; showPwdForm = true; }}>
										<KeyRound class="mr-1 h-3.5 w-3.5" /> 改密
									</Button>
									{#if (u.sessionCount ?? 0) > 0}
										<Button variant="ghost" size="sm" title="吊销该用户全部会话" onclick={() => revokeSessions(u.username)}>
											<ShieldOff class="h-3.5 w-3.5" />
										</Button>
									{/if}
									{#if u.username !== "admin"}
										<Button variant="ghost" size="sm" class="text-destructive hover:text-destructive" onclick={() => removeUser(u.username)}>
											<Trash2 class="h-3.5 w-3.5" />
										</Button>
									{/if}
								</div>
							</TableCell>
						</TableRow>
					{:else}
						<TableRow>
							<TableCell colspan={7} class="h-24 text-center text-muted-foreground">无匹配用户</TableCell>
						</TableRow>
					{/each}
				</TableBody>
			</Table>
		</div>
	</div>
{/if}
