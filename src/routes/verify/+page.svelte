<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import { ShieldCheck, ShieldX, Loader2, MailWarning } from "@lucide/svelte";
	import { onMount } from "svelte";

	let token = $state("");
	let state = $state<"loading" | "ok" | "fail">("loading");
	let errMsg = $state("");

	onMount(() => {
		const params = new URLSearchParams(location.search);
		token = params.get("token") || "";
		if (!token) {
			state = "fail";
			errMsg = "缺少验证令牌：请从邮箱中的验证链接进入本页";
			return;
		}
		verify();
	});

	async function verify() {
		state = "loading";
		try {
			const res = await fetch("/api/auth", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "verify", token })
			});
			const d = await res.json();
			if (res.ok && d.ok) {
				state = "ok";
			} else {
				state = "fail";
				errMsg = d.error || "验证失败，请稍后重试";
			}
		} catch {
			state = "fail";
			errMsg = "无法连接服务器，请检查网络或稍后重试";
		}
	}

	function goLogin() {
		location.href = "/admin/login";
	}

	function goRegister() {
		location.href = "/register";
	}
</script>

<svelte:head>
	<title>邮箱验证 | Stelarith</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="flex min-h-[70vh] items-center justify-center px-4 py-10">
	<div class="w-full max-w-md space-y-6">
		<div class="flex flex-col items-center gap-2 text-center">
			<div class="flex size-12 items-center justify-center rounded-xl bg-primary font-heading text-lg font-semibold text-primary-foreground">S</div>
			<h1 class="font-heading text-2xl font-semibold">邮箱验证</h1>
		</div>

		<div class="space-y-4 rounded-xl border border-border/60 bg-card p-6 text-center">
			{#if state === "loading"}
				<div class="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
					<Loader2 class="size-6 animate-spin" />
				</div>
				<p class="text-sm text-muted-foreground">正在验证邮箱，请稍候…</p>
			{:else if state === "ok"}
				<div class="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
					<ShieldCheck class="size-6" />
				</div>
				<h2 class="font-heading text-lg font-semibold">验证成功 🎉</h2>
				<p class="text-sm text-muted-foreground">账号已激活，现在可以登录了。</p>
				<Button href="/admin/login" class="w-full">前往登录</Button>
			{:else}
				<div class="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
					<ShieldX class="size-6" />
				</div>
				<h2 class="font-heading text-lg font-semibold">验证未通过</h2>
				<p class="text-sm text-muted-foreground">{errMsg}</p>
				{#if errMsg.includes("过期") || errMsg.includes("无效")}
					<div class="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/40 p-3 text-left">
						<MailWarning class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
						<p class="text-xs text-muted-foreground">验证链接已过期或失效。可联系管理员在后台重新批准，或重新注册获取新的验证链接。</p>
					</div>
					<div class="grid gap-2">
						<Button class="w-full" onclick={goRegister}>重新注册</Button>
						<Button variant="outline" class="w-full" onclick={goLogin}>去登录</Button>
					</div>
				{/if}
			{/if}
		</div>
	</div>
</div>
