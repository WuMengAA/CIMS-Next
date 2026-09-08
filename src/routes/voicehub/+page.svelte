<script lang="ts">
	import type { PageProps } from "./$types";
	import { Music2, ExternalLink, ListMusic } from "@lucide/svelte";

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>校园点歌 | Stelarith</title>
	<meta name="description" content="校园点歌实时榜，由 voicehub 校园点歌站提供" />
</svelte:head>

<div class="mx-auto flex w-full max-w-[1400px] flex-col gap-8 px-4 py-10 md:px-8">
	<header class="flex flex-col gap-2">
		<h1 class="flex items-center gap-2 font-heading text-3xl font-semibold tracking-tight">
			<Music2 class="size-7 text-primary" /> 校园点歌
		</h1>
		<p class="text-sm text-muted-foreground">实时点歌榜 · 数据由 voicehub 校园点歌站提供</p>
		<a
			href="https://voicehub.245959623.xyz"
			target="_blank"
			rel="noopener"
			class="inline-flex w-fit items-center gap-1 text-sm text-primary hover:underline"
		>
			去 voicehub 点歌 <ExternalLink class="size-4" />
		</a>
	</header>

	{#if !data.configured}
		<div class="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
			点歌站尚未接入（未配置 VOICEHUB_BASE / VOICEHUB_KEY）。<br />
			在 .env 配置后即可显示实时点歌榜。
		</div>
	{:else if data.error}
		<div class="rounded-xl border border-red-500/40 bg-red-500/10 p-8 text-center text-sm">
			<p class="font-medium text-red-300">已配置 Voicehub，但连接失败</p>
			<p class="mt-2 text-muted-foreground">
				HTTP 状态：{data.errorStatus ?? "未知（网络异常）"}。<br />
				请检查 VOICEHUB_KEY 是否有效、是否具备 <code class="rounded bg-black/30 px-1">songs:read</code> 权限，且 VOICEHUB_BASE 指向正确的实例。
			</p>
		</div>
	{:else}
		<section class="rounded-2xl border p-6">
			<h2 class="mb-3 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
				正在播放
			</h2>
			{#if data.now}
				<div class="flex items-center gap-4">
					{#if data.now.cover}
						<img src={data.now.cover} alt="" class="size-20 rounded-lg object-cover" />
					{/if}
					<div>
						<div class="text-2xl font-bold">{data.now.title}</div>
						<div class="text-muted-foreground">{data.now.artist}</div>
						<div class="mt-1 text-xs text-muted-foreground">
							点歌人：{data.now.by}{data.now.at ? ` · ${data.now.at}` : ""}
						</div>
					</div>
				</div>
			{:else}
				<p class="text-sm text-muted-foreground">暂无播放中曲目</p>
			{/if}
		</section>

		<section class="rounded-2xl border p-6">
			<h2
				class="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-muted-foreground"
			>
				<ListMusic class="size-4" /> 待播队列（{data.queue.length}）
			</h2>
			{#if data.queue.length === 0}
				<p class="text-sm text-muted-foreground">暂无待播歌曲，去点一首吧～</p>
			{:else}
				<ul class="flex flex-col gap-2">
					{#each data.queue as s, i (i)}
						<li class="flex items-center gap-3 rounded-lg border px-4 py-3">
							<span class="w-6 text-center text-sm font-semibold text-primary">{i + 1}</span>
							{#if s.cover}
								<img src={s.cover} alt="" class="size-10 rounded object-cover" />
							{/if}
							<div class="min-w-0 flex-1">
								<div class="truncate font-medium">{s.title}</div>
								<div class="truncate text-xs text-muted-foreground">
									{s.artist}{s.by ? ` · ${s.by}` : ""}
								</div>
							</div>
							<span class="text-xs text-muted-foreground">♥ {s.votes}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}
</div>
