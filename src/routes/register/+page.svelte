<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { UserPlus, Eye, EyeOff, Mail, User as UserIcon, ShieldCheck } from "@lucide/svelte";
	import { toast } from "svelte-sonner";

	let username = $state("");
	let displayName = $state("");
	let email = $state("");
	let password = $state("");
	let password2 = $state("");
	let showPwd = $state(false);
	let submitting = $state(false);

	// 注册成功后的验证状态：成功即展示验证链接（本地无 SMTP 时由服务端回传令牌拼链接）。
	let done = $state(false);
	let verifyUrl = $state("");
	let errMsg = $state("");

	async function submit() {
		errMsg = "";
		if (!username.trim() || !password) {
			errMsg = "用户名和密码必填";
			return;
		}
		if (password.length < 6) {
			errMsg = "密码至少 6 位";
			return;
		}
		if (password !== password2) {
			errMsg = "两次输入的密码不一致";
			return;
		}
		submitting = true;
		try {
			const res = await fetch("/api/auth", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					action: "register",
					username: username.trim(),
					displayName: displayName.trim(),
					email: email.trim(),
					password
				})
			});
			const d = await res.json();
			if (res.ok && d.ok) {
				// 服务端回传 verifyToken（本地无 SMTP 环境）；拼出验证链接供用户打开。
				if (d.verifyToken) {
					verifyUrl = `${location.origin}/verify?token=${encodeURIComponent(d.verifyToken)}`;
				}
				done = true;
				toast.success("注册成功，请完成邮箱验证");
			} else {
				errMsg = d.error || "注册失败，请稍后重试";
			}
		} catch {
			errMsg = "无法连接服务器，请检查网络或稍后重试";
		}
		submitting = false;
	}
</script>

<svelte:head>
	<title>注册账号 | Stelarith</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="flex min-h-[70vh] items-center justify-center px-4 py-10">
	<div class="w-full max-w-md space-y-6">
		<div class="flex flex-col items-center gap-2 text-center">
			<div class="flex size-12 items-center justify-center rounded-xl bg-primary font-heading text-lg font-semibold text-primary-foreground">S</div>
			<h1 class="font-heading text-2xl font-semibold">注册账号</h1>
			<p class="text-sm text-muted-foreground">加入 Stelarith 社区，创建你的公开主页</p>
		</div>

		{#if done}
			<div class="space-y-4 rounded-xl border border-border/60 bg-card p-6 text-center">
				<div class="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
					<ShieldCheck class="size-6" />
				</div>
				<h2 class="font-heading text-lg font-semibold">注册成功，还差最后一步</h2>
				<p class="text-sm text-muted-foreground">请打开下方验证链接完成邮箱验证，验证后即可登录。</p>
				{#if verifyUrl}
					<div class="rounded-lg border border-border/60 bg-muted/40 p-3">
						<a href={verifyUrl} class="break-all text-sm text-primary underline underline-offset-4">{verifyUrl}</a>
					</div>
					<Button href={verifyUrl} class="w-full">
						前往验证
					</Button>
				{:else}
					<p class="text-sm text-muted-foreground">验证链接将发送至你的邮箱。</p>
				{/if}
			</div>
		{:else}
			<form onsubmit={(e) => { e.preventDefault(); submit(); }} class="space-y-4 rounded-xl border border-border/60 bg-card p-6">
				<div class="space-y-2">
					<Label for="reg-username">用户名</Label>
					<div class="relative">
						<UserIcon class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
						<Input id="reg-username" bind:value={username} placeholder="2-20 位字母/数字/下划线/汉字" class="pl-9" autocomplete="username" required />
					</div>
				</div>

				<div class="space-y-2">
					<Label for="reg-display">显示名称（可选）</Label>
					<Input id="reg-display" bind:value={displayName} placeholder="昵称，默认为用户名" />
				</div>

				<div class="space-y-2">
					<Label for="reg-email">邮箱</Label>
					<div class="relative">
						<Mail class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
						<Input id="reg-email" type="email" bind:value={email} placeholder="用于接收验证链接" class="pl-9" autocomplete="email" />
					</div>
				</div>

				<div class="space-y-2">
					<Label for="reg-password">密码</Label>
					<div class="relative">
						<Input id="reg-password" type={showPwd ? "text" : "password"} bind:value={password} placeholder="至少 6 位" class="pr-10" autocomplete="new-password" required />
						<button type="button" onclick={() => (showPwd = !showPwd)} class="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
							{#if showPwd}<EyeOff class="size-4" />{:else}<Eye class="size-4" />{/if}
						</button>
					</div>
				</div>

				<div class="space-y-2">
					<Label for="reg-password2">确认密码</Label>
					<Input id="reg-password2" type={showPwd ? "text" : "password"} bind:value={password2} placeholder="再次输入密码" autocomplete="new-password" required />
				</div>

				{#if errMsg}
					<p class="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">{errMsg}</p>
				{/if}

				<Button type="submit" class="w-full" disabled={submitting}>
					<UserPlus class="mr-2 size-4" />
					{submitting ? "提交中..." : "注册"}
				</Button>

				<p class="text-center text-xs text-muted-foreground">
					已有账号？
					<a href="/admin/login" class="text-primary underline underline-offset-4">去登录</a>
				</p>
			</form>
		{/if}
	</div>
</div>
