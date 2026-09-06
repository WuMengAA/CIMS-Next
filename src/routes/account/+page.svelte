<script lang="ts">
	import { onMount } from "svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { User, KeyRound, Download, LogOut, Loader2, ShieldCheck, CalendarDays } from "@lucide/svelte";

	interface Me { username: string; displayName: string; role: string; createdAt: string; }
	let me = $state<Me | null>(null);
	let loading = $state(true);

	// Password change form
	let currentPassword = $state("");
	let newPassword = $state("");
	let pwdMsg = $state("");
	let pwdErr = $state("");
	let changing = $state(false);

	async function load() {
		loading = true;
		try {
			const res = await fetch("/api/me");
			if (res.ok) me = await res.json();
		} catch (e) { console.error(e); }
		loading = false;
	}

	async function changePwd() {
		pwdErr = ""; pwdMsg = "";
		if (!currentPassword || !newPassword) { pwdErr = "请填写当前密码和新密码"; return; }
		changing = true;
		try {
			const res = await fetch("/api/me/password", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ currentPassword, newPassword })
			});
			const data = await res.json();
			if (res.ok) {
				pwdMsg = "密码已修改";
				currentPassword = ""; newPassword = "";
				setTimeout(() => (pwdMsg = ""), 3000);
			} else {
				pwdErr = data.error || "修改失败";
			}
		} catch (e) { pwdErr = "网络错误"; }
		changing = false;
	}

	async function exportBackup() {
		try {
			const res = await fetch("/api/backup");
			if (!res.ok) return;
			const blob = await res.blob();
			const fn = res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] || "backup.json";
			const a = document.createElement("a");
			a.href = URL.createObjectURL(blob);
			a.download = fn;
			a.click();
			URL.revokeObjectURL(a.href);
		} catch (e) { console.error(e); }
	}

	async function logout() {
		await fetch("/api/auth", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "logout" })
		});
		window.location.href = "/account";
	}

	onMount(load);
</script>

<svelte:head>
	<title>账号 | Stelarith</title>
</svelte:head>

<div class="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 md:px-8">
	<header class="flex flex-col gap-2">
		<h1 class="font-heading text-3xl font-semibold tracking-tight">账号</h1>
		<p class="text-sm text-muted-foreground">登录状态、密码与数据管理</p>
	</header>

{#if loading}
	<div class="flex items-center gap-2 text-muted-foreground"><Loader2 class="size-4 animate-spin" /> 加载中...</div>
{:else if !me}
	<!-- Not logged in -->
	<div class="flex flex-col items-center gap-4 rounded-xl border border-dashed p-10 text-center">
		<div class="flex size-12 items-center justify-center rounded-full bg-primary/15 text-primary"><User class="size-6" /></div>
		<h2 class="font-heading text-lg">未登录</h2>
		<p class="text-sm text-muted-foreground">登录后可管理内容、修改密码和导出备份。</p>
		<Button asChild><a href="/admin/login">去登录</a></Button>
	</div>
{:else}
	<!-- Logged in -->
	<div class="flex flex-col gap-4 rounded-xl border border-border/60 bg-card p-6">
		<div class="flex flex-wrap items-center gap-3">
			<div class="flex size-12 items-center justify-center rounded-full bg-primary/15 font-heading text-lg font-semibold text-primary">{me.displayName?.slice(0, 1) || me.username?.slice(0, 1)}</div>
			<div class="flex min-w-0 flex-1 flex-col gap-1">
				<div class="flex items-center gap-2">
					<span class="truncate font-heading text-lg font-medium">{me.displayName || me.username}</span>
					{#if me.role === "admin"}<Badge>管理员</Badge>{:else}<Badge variant="outline">编辑</Badge>{/if}
				</div>
				<p class="inline-flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground"><ShieldCheck class="size-3 shrink-0" /> <span class="truncate">@{me.username}</span> · <CalendarDays class="size-3 shrink-0" /> 注册于 {me.createdAt?.slice(0, 10)}</p>
			</div>
			<Button variant="ghost" size="sm" class="ml-auto shrink-0 text-muted-foreground hover:text-destructive" onclick={logout}><LogOut class="h-4 w-4 mr-1" /> 退出</Button>
		</div>
	</div>

	<!-- Change password -->
	<div class="flex flex-col gap-4 rounded-xl border border-border/60 bg-card p-6">
		<h2 class="flex items-center gap-2 font-heading text-lg font-medium"><KeyRound class="size-4 text-primary" /> 修改密码</h2>
		<div class="grid max-w-md gap-3">
			<div class="grid gap-1.5"><Label>当前密码</Label><Input type="password" bind:value={currentPassword} placeholder="当前密码" /></div>
			<div class="grid gap-1.5"><Label>新密码（至少 6 位）</Label><Input type="password" bind:value={newPassword} placeholder="新密码" /></div>
			{#if pwdErr}<p class="text-sm text-destructive">{pwdErr}</p>{/if}
			{#if pwdMsg}<p class="text-sm text-primary">{pwdMsg}</p>{/if}
			<div><Button onclick={changePwd} disabled={changing || !currentPassword || !newPassword}>{changing ? "修改中..." : "确认修改"}</Button></div>
		</div>
	</div>

	<!-- Backup -->
	<div class="flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-6">
		<h2 class="flex items-center gap-2 font-heading text-lg font-medium"><Download class="size-4 text-primary" /> 数据备份</h2>
		<p class="text-sm text-muted-foreground">导出你有权访问的全部内容（文章、项目、文档）为 JSON 文件。</p>
		<div><Button variant="outline" onclick={exportBackup}><Download class="h-4 w-4 mr-2" />导出我的数据</Button></div>
	</div>
{/if}
</div>