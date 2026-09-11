<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { LogIn, Eye, EyeOff, User as UserIcon } from "@lucide/svelte";
	import { superForm } from "sveltekit-superforms";
	import { zod4Client, type ClientValidationAdapter } from "sveltekit-superforms/adapters";
	import { toast } from "svelte-sonner";
	import type { PageProps } from "./$types";
	import { loginSchema, type LoginForm } from "$lib/schemas/login.js";

	let { data }: PageProps = $props();

	let showPwd = $state(false);

	// 不使用 formsnap：其 Field 组件在 SSR 期依赖 form.current.errors 内部 store，
	// 而当前 sveltekit-superforms 版本 form.current 返回表单数据对象，导致 500。
	// 改用 superForm 原生 API（errors/enhance/submitting 均为 SSR 安全的 Svelte store）。
	//
	// 客户端校验器：
	// ⚠️ 两个必须注意的点（都踩过）：
	//   1. 适配器是 zod4Client，不能用 zodClient —— 前者是 zod v4 适配器，后者是 v3。
	//      本项目 zod 是 v4，混用会让校验器拿到不兼容的 schema 而抛异常。
	//   2. 必须把 schema 传进去（zod4Client(loginSchema)），无参调用会让内部对
	//      undefined 调 safeParseAsync 直接崩。
	// 另外这里再包一层 try/catch 兜底：客户端校验器一旦抛异常，会打断 superforms 的
	// 提交流程，按钮将永远停在「登录中...」。兜底放行后由服务端做最终校验，
	// 保证「校验器坏了」永远不会演变成「登录按不动」。
	// 断言说明：superforms 2.30 对 zod v4 的 Infer 映射不完整（会把 Out 推成 ZodObject 本身），
	// 这里显式断言为正确的客户端适配器类型；运行期行为不受影响。
	const clientValidators = (() => {
		const adapter = zod4Client(loginSchema);
		return {
			...adapter,
			validate: async (data: unknown) => {
				try {
					return await adapter.validate(data);
				} catch (e) {
					console.error("[login] 客户端校验异常，已降级为服务端校验", e);
					return { data, success: true as const };
				}
			}
		};
	})() as unknown as ClientValidationAdapter<Partial<LoginForm>>;

	const { form, errors, message, enhance, submitting } = superForm(data.form, {
		validators: clientValidators,
		// 注意：这里必须是 onUpdate，不能用 onUpdated。
		//   onUpdate  —— 用于接收「表单动作的返回值」（success / failure），事件形参是 { form, result }
		//   onUpdated —— 用于页面数据刷新后的回调，事件形参只有 { form }，没有 result
		// 之前误用 onUpdated 并解构 result，会在回调里抛 TypeError，导致失败提示永远弹不出来。
		onUpdate: ({ form, result }) => {
			if (result.type === "failure") {
				toast.error(form.message || "登录失败，请检查用户名和密码");
			}
		},
		onError: ({ result }) => {
			// 服务端 5xx / 网络异常：同样必须给出可见反馈，
			// 否则用户点击「登录」后页面毫无反应，会误以为系统卡死。
			toast.error(
				(result as { error?: { message?: string } })?.error?.message ||
					"无法连接服务器，请检查网络或稍后重试"
			);
		}
	});
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

		<form method="POST" use:enhance class="space-y-4 rounded-xl border border-border/60 bg-card p-6">
			<div class="space-y-2">
				<Label for="username" class="mb-2">用户名</Label>
				<div class="relative">
					<UserIcon class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input id="username" name="username" bind:value={$form.username} placeholder="用户名" class="pl-9" autocomplete="username" />
				</div>
				{#if $errors.username}
					<p class="mt-1.5 text-sm text-destructive">{$errors.username.join(" ")}</p>
				{/if}
			</div>

			<div class="space-y-2">
				<Label for="password" class="mb-2">密码</Label>
				<div class="relative">
					<Input id="password" name="password" type={showPwd ? "text" : "password"} bind:value={$form.password} placeholder="密码" class="pr-10" autocomplete="current-password" />
					<button type="button" onclick={() => (showPwd = !showPwd)} class="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
						{#if showPwd}
							<EyeOff class="h-4 w-4" />
						{:else}
							<Eye class="h-4 w-4" />
						{/if}
					</button>
				</div>
				{#if $errors.password}
					<p class="mt-1.5 text-sm text-destructive">{$errors.password.join(" ")}</p>
				{/if}
			</div>

			{#if $message}
				<p class="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">
					{$message}
				</p>
			{/if}

			<!--
				必须显式写 type="submit"：Button 组件的 type 默认是 "button"，
				缺省时按钮不会触发表单提交，点击「登录」将毫无反应（既不请求也不跳转）。
				表单内有两个输入框，浏览器也不会做隐式提交，所以这是唯一的提交入口。
			-->
			<Button type="submit" class="w-full" disabled={$submitting}>
				<LogIn class="h-4 w-4 mr-2" />
				{$submitting ? "登录中..." : "登录"}
			</Button>
		</form>

		<p class="text-center text-xs text-muted-foreground">首次登录默认密码为生成值，请立即修改（或通过 ADMIN_PASSWORD 环境变量设置）</p>
	</div>
</div>
