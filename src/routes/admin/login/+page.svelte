<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { LogIn, Eye, EyeOff, User as UserIcon } from "@lucide/svelte";
	import { superForm } from "sveltekit-superforms";
	import { zodClient } from "sveltekit-superforms/adapters";
	import { Field, Control, Label, FieldErrors } from "formsnap";
	import { toast } from "svelte-sonner";
	import type { PageProps } from "./$types";
	import type { LoginForm } from "./+page.server";

	let { data }: PageProps = $props();

	let showPwd = $state(false);

	const form = superForm(data.form, {
		validators: zodClient<LoginForm>(),
		onUpdated: ({ result }) => {
			if (result.type === "failure" && result.message) {
				toast.error(result.message);
			}
		}
	});

	const submitting = $derived(form.submitting.current);
</script>

<svelte:head>
	<title>登录 | Stelarith CMS</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-background px-4">
	<div class="w-full max-w-sm space-y-6">
		<div class="flex flex-col items-center gap-2 text-center">
			<div class="flex size-12 items-center justify-center rounded-xl bg-primary font-heading text-lg font-semibold text-primary-foreground">S</div>
			<h1 class="font-heading text-2xl font-semibold">Stelarith CMS</h1>
			<p class="text-sm text-muted-foreground">登录管理后台</p>
		</div>

		<form method="POST" use:form class="space-y-4 rounded-xl border border-border/60 bg-card p-6">
			<Field {form} name="username">
				<Control>
					{#snippet children({ props })}
						<Label class="mb-2">用户名</Label>
						<div class="relative">
							<UserIcon class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
							<Input {...props} placeholder="用户名" class="pl-9" />
						</div>
					{/snippet}
				</Control>
				<FieldErrors class="mt-1.5 text-sm text-destructive" />
			</Field>

			<Field {form} name="password">
				<Control>
					{#snippet children({ props })}
						<Label class="mb-2">密码</Label>
						<div class="relative">
							<Input {...props} type={showPwd ? "text" : "password"} placeholder="密码" class="pr-10" />
							<button type="button" onclick={() => (showPwd = !showPwd)} class="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
								{#if showPwd}
									<EyeOff class="h-4 w-4" />
								{:else}
									<Eye class="h-4 w-4" />
								{/if}
							</button>
						</div>
					{/snippet}
				</Control>
				<FieldErrors class="mt-1.5 text-sm text-destructive" />
			</Field>

			<Button class="w-full" disabled={submitting}>
				<LogIn class="h-4 w-4 mr-2" />
				{submitting ? "登录中..." : "登录"}
			</Button>
		</form>

		<p class="text-center text-xs text-muted-foreground">首次登录默认密码为生成值，请立即修改（或通过 ADMIN_PASSWORD 环境变量设置）</p>
	</div>
</div>
