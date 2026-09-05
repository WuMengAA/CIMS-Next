<script lang="ts">
	import { Input } from "$lib/components/ui/input/index.js";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Search, Heart, GitFork, FileJson2, Send, CheckCircle2, ExternalLink } from "@lucide/svelte";
	import Container from "$lib/components/container.svelte";
	import PageHeader from "$lib/components/page-header.svelte";

	let { data }: { data: { links: { name: string; url: string; description?: string; avatar?: string }[] } } = $props();

	const steps = [
		{ title: "Fork 数据仓库", desc: "Fork afoim/af_friends-data" },
		{ title: "新建 JSON 文件", desc: "在 data/friends/ 下新建 JSON 文件" },
		{ title: "提交 Pull Request", desc: "填写右侧模板并提交 Pull Request" },
		{ title: "自动校验上线", desc: "自动流程校验通过后部署上线" }
	];

	// 友链申请 form state
	let appName = $state("");
	let appUrl = $state("");
	let appDesc = $state("");
	let appEmail = $state("");
	let appMsg = $state("");
	let appErr = $state("");

	async function submitApplication() {
		appErr = ""; appMsg = "";
		if (!appName.trim() || !appUrl.trim()) { appErr = "请填写站点名称和网址"; return; }
		try {
			const res = await fetch("/api/link-applications", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "submit", name: appName, url: appUrl, description: appDesc, email: appEmail })
			});
			const data = await res.json();
			if (res.ok) {
				appMsg = "申请已提交，审核通过后会显示在友链区";
				appName = ""; appUrl = ""; appDesc = ""; appEmail = "";
			} else {
				appErr = data.error || "提交失败";
			}
		} catch (e) { appErr = "网络错误"; }
	}
</script>

<svelte:head>
	<title>连接 | Stelarith</title>
</svelte:head>

<Container class="gap-10">
	<PageHeader title="连接" description="支持 Stelarith，联系我，交换友情链接。" />

	<!-- Support / Contact -->
	<section class="grid gap-4 md:grid-cols-2">
		<div class="flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-6">
			<div class="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
				<Heart class="size-5" />
			</div>
			<h2 class="font-heading text-lg font-medium">支持 Stelarith</h2>
			<p class="text-sm leading-relaxed text-muted-foreground">
				如果你喜欢这个站点，可以通过爱发电赞助支持我，让我有更多动力持续维护。
			</p>
			<Button asChild variant="secondary" class="w-fit gap-2">
				<a href="https://www.ifdian.net/a/stelarith" target="_blank" rel="noopener noreferrer">
					赞助支持
					<ExternalLink class="size-4" />
				</a>
			</Button>
		</div>
		<div class="flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-6">
			<div class="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
				<Send class="size-5" />
			</div>
			<h2 class="font-heading text-lg font-medium">联系我</h2>
			<p class="text-sm leading-relaxed text-muted-foreground">
				加群交流请前往置顶文章，或在 GitHub 提交 Issue 反馈。
			</p>
			<Button asChild variant="secondary" class="w-fit gap-2">
				<a href="/posts/friend-group-guide">
					加群向导
					<ExternalLink class="size-4" />
				</a>
			</Button>
		</div>
	</section>

	<!-- Friend links -->
	<section class="flex flex-col gap-4">
		<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			<h2 class="font-heading text-xl font-medium">友情链接</h2>
			<div class="relative w-full sm:w-48">
				<Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
				<Input placeholder="搜索友链" class="w-full pl-9" />
			</div>
		</div>
		<div class="grid gap-3 sm:grid-cols-2">
			{#each data.links as f (f.url)}
				<a
					href={f.url}
					target="_blank"
					rel="noopener noreferrer"
					class="flex items-center gap-3 rounded-xl border border-border/60 bg-card p-4 transition-colors hover:border-primary/40"
				>
					<div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted font-heading text-lg">
						{f.avatar || f.name.charAt(0)}
					</div>
					<div class="min-w-0">
						<p class="truncate text-sm font-medium">{f.name}</p>
						<p class="truncate text-xs text-muted-foreground">{f.description || f.name}</p>
					</div>
				</a>
			{/each}
		</div>
	</section>

	<!-- How to apply -->
	<section class="flex flex-col gap-4 rounded-xl border border-border/60 bg-card p-6">
		<div class="flex items-center gap-2">
			<GitFork class="size-5 text-primary" />
			<h2 class="font-heading text-lg font-medium">如何申请友链</h2>
		</div>
		<p class="text-sm leading-relaxed text-muted-foreground">
			Fork 数据仓库，在 data/friends/ 下添加 JSON，提交 Pull Request。自动流程会检查格式，通过后就会出现在这里。
		</p>
		<ol class="flex flex-col gap-3">
			{#each steps as s, i (s.title)}
				<li class="flex items-start gap-3">
					<span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
						{i + 1}
					</span>
					<div>
						<p class="text-sm font-medium">{s.title}</p>
						<p class="text-xs text-muted-foreground">{s.desc}</p>
					</div>
				</li>
			{/each}
		</ol>
		<div class="flex flex-col gap-2 rounded-lg bg-muted/40 p-4">
			<div class="flex items-center gap-2 text-sm font-medium">
				<FileJson2 class="size-4 text-primary" />
				friends.json 字段：name、url、avatar、description
			</div>
			<pre class="overflow-x-auto rounded-md bg-background p-3 text-xs leading-relaxed text-muted-foreground"><code>{"{"}
  "name": "你的站点名",
  "avatar": "https://.../头像.png",
  "description": "一句话简介",
  "url": "https://你的站点/"
{"}"}</code></pre>
			<Button asChild variant="secondary" class="w-fit gap-2">
				<a href="https://github.com/afoim/af_friends-data" target="_blank" rel="noopener noreferrer">
					去 Fork
					<ExternalLink class="size-4" />
				</a>
			</Button>
		</div>
	</section>

	
	<!-- Application form -->
	<section id="apply" class="flex flex-col gap-4 rounded-xl border border-border/60 bg-card p-6">
		<div class="flex items-center gap-2">
			<Send class="size-5 text-primary" />
			<h2 class="font-heading text-lg font-medium">在线申请友链</h2>
		</div>
		<p class="text-sm leading-relaxed text-muted-foreground">填写以下信息提交申请，审核通过后自动出现在上方友链区。</p>
		<div class="grid gap-3 sm:grid-cols-2">
			<input bind:value={appName} placeholder="你的站点名称（必填）" maxlength="50" class="h-9 rounded-md border bg-background px-3 text-sm outline-none focus:border-primary/60" />
			<input bind:value={appUrl} placeholder="https://你的站点/（必填）" maxlength="200" class="h-9 rounded-md border bg-background px-3 text-sm outline-none focus:border-primary/60" />
			<input bind:value={appDesc} placeholder="一句话简介（可选）" maxlength="100" class="h-9 rounded-md border bg-background px-3 text-sm outline-none focus:border-primary/60" />
			<input bind:value={appEmail} placeholder="联系邮箱（可选）" maxlength="100" class="h-9 rounded-md border bg-background px-3 text-sm outline-none focus:border-primary/60" />
		</div>
		{#if appErr}
			<p class="text-sm text-destructive">{appErr}</p>
		{/if}
		{#if appMsg}
			<p class="text-sm text-primary">{appMsg}</p>
		{/if}
		<div>
			<Button onclick={submitApplication} disabled={!appName.trim() || !appUrl.trim()}>提交申请</Button>
		</div>
	</section>
	<!-- Steps visual -->
	<section class="flex flex-col gap-3">
		{#each steps as s, i (s.title)}
			<div class="flex items-center gap-3">
				<span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
					<CheckCircle2 class="size-4" />
				</span>
				<div class="flex-1">
					<p class="text-sm font-medium">{i + 1} {s.title}</p>
					<p class="text-xs text-muted-foreground">{s.desc}</p>
				</div>
			</div>
		{/each}
	</section>
</Container>