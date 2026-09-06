<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import Container from "$lib/components/container.svelte";

	let { data }: { data: { user?: { username: string; role: string } | null } } = $props();

	let name = $state("");
	let summary = $state("");
	let repo = $state("");
	let website = $state("");
	let category = $state("");
	let msg = $state("");
	let err = $state("");
	let submitting = $state(false);

	async function submit() {
		err = ""; msg = "";
		if (!name.trim() || !summary.trim()) { err = "请填写名称与简介"; return; }
		submitting = true;
		try {
			const res = await fetch("/api/project-applications", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name, summary, repo, website, category })
			});
			if (res.ok) {
				name = ""; summary = ""; repo = ""; website = ""; category = "";
				msg = "申请已提交，管理员审核通过后将为你的软件开通专页";
			} else {
				const d = await res.json();
				err = d.error || "提交失败";
			}
		} catch { err = "网络错误"; }
		submitting = false;
	}
</script>

<svelte:head><title>申请软件专页 | Stelarith</title></svelte:head>

<Container>
	<div class="mx-auto max-w-2xl">
		<h1 class="font-heading text-2xl font-semibold tracking-tight">申请软件专页</h1>
		<p class="mt-2 text-sm text-muted-foreground">提交你的软件信息，审核通过后将在「项目」下生成专属页面，并归属到你名下。</p>

		{#if data.user}
			<div class="mt-6 flex flex-col gap-4 rounded-xl border border-border/60 bg-card p-5">
				<div>
					<label class="mb-1 block text-sm font-medium">软件名称 *</label>
					<input bind:value={name} maxlength="80" placeholder="例如：星璃·无限音乐画布" class="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary/60" />
				</div>
				<div>
					<label class="mb-1 block text-sm font-medium">简介 *</label>
					<textarea bind:value={summary} rows={4} maxlength="500" placeholder="一句话介绍它是什么、能做什么" class="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60"></textarea>
				</div>
				<div class="grid gap-4 sm:grid-cols-2">
					<div>
						<label class="mb-1 block text-sm font-medium">仓库地址</label>
						<input bind:value={repo} maxlength="300" placeholder="https://github.com/..." class="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary/60" />
					</div>
					<div>
						<label class="mb-1 block text-sm font-medium">官网</label>
						<input bind:value={website} maxlength="300" placeholder="https://..." class="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary/60" />
					</div>
				</div>
				<div>
					<label class="mb-1 block text-sm font-medium">分类</label>
					<input bind:value={category} maxlength="40" placeholder="例如：音乐 / 工具" class="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary/60" />
				</div>
				{#if err}<p class="text-xs text-destructive">{err}</p>{/if}
				{#if msg}<p class="text-xs text-primary">{msg}</p>{/if}
				<div class="flex justify-end">
					<Button onclick={submit} disabled={submitting}>{submitting ? "提交中…" : "提交申请"}</Button>
				</div>
			</div>
		{:else}
			<p class="mt-6 text-sm text-muted-foreground"><a href="/admin/login" class="text-primary hover:underline">登录</a> 后可提交软件专页申请。</p>
		{/if}
	</div>
</Container>
