<script lang="ts">
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { BookOpen, Rocket, BookMarked, CalendarDays, ShieldCheck } from "@lucide/svelte";
	import Container from "$lib/components/container.svelte";

	const ROLE_LABEL: Record<string, string> = { admin: "管理员", editor: "编辑", moderator: "审核员", user: "成员" };

	let { data }: {
		data: {
			profile: { username: string; displayName: string; role: string; bio?: string; createdAt: string };
			content: { posts: any[]; projects: any[]; docs: any[] };
		};
	} = $props();
</script>

<svelte:head>
	<title>{data.profile.displayName} 的主页 | Stelarith</title>
	<meta name="description" content={data.profile.displayName + " 在 Stelarith 发布的内容"} />
</svelte:head>

<Container>
	<div class="flex flex-col gap-10">
		<!-- 资料卡 -->
		<header class="flex items-center gap-5 rounded-xl border border-border/60 bg-card p-6">
			<div class="flex size-16 items-center justify-center rounded-full bg-primary/15 font-heading text-2xl font-semibold text-primary">
				{(data.profile.displayName || data.profile.username).slice(0, 1).toUpperCase()}
			</div>
			<div class="flex min-w-0 flex-1 flex-col gap-1.5">
				<div class="flex flex-wrap items-center gap-2">
					<h1 class="font-heading text-2xl font-semibold tracking-tight">{data.profile.displayName || data.profile.username}</h1>
					<Badge variant={data.profile.role === "admin" ? "default" : "outline"} class="gap-1">
						<ShieldCheck class="size-3" /> {ROLE_LABEL[data.profile.role] || data.profile.role}
					</Badge>
				</div>
				<p class="text-xs text-muted-foreground">@{data.profile.username} · 注册于 {data.profile.createdAt?.slice(0, 10)}</p>
				{#if data.profile.bio}<p class="text-sm text-muted-foreground">{data.profile.bio}</p>{/if}
			</div>
		</header>

		<!-- 文章 -->
		<section>
			<h2 class="mb-3 flex items-center gap-2 font-heading text-lg font-semibold"><BookOpen class="size-5 text-primary" /> 文章（{data.content.posts.length}）</h2>
			{#if data.content.posts.length}
				<div class="flex flex-col divide-y divide-border/40 rounded-xl border border-border/60">
					{#each data.content.posts as p (p.slug)}
						<a href="/posts/{p.slug}" class="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-accent/40">
							<span class="truncate text-sm font-medium">{p.title}</span>
							<span class="shrink-0 text-xs text-muted-foreground">{p.date}</span>
						</a>
					{/each}
				</div>
			{:else}<p class="text-sm text-muted-foreground">暂无发布。</p>{/if}
		</section>

		<!-- 项目 -->
		<section>
			<h2 class="mb-3 flex items-center gap-2 font-heading text-lg font-semibold"><Rocket class="size-5 text-primary" /> 项目（{data.content.projects.length}）</h2>
			{#if data.content.projects.length}
				<div class="flex flex-col divide-y divide-border/40 rounded-xl border border-border/60">
					{#each data.content.projects as pr (pr.slug)}
						<a href="/projects/{pr.slug}" class="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-accent/40">
							<span class="truncate text-sm font-medium">{pr.title}</span>
							<span class="shrink-0 text-xs text-muted-foreground">{pr.date}</span>
						</a>
					{/each}
				</div>
			{:else}<p class="text-sm text-muted-foreground">暂无发布。</p>{/if}
		</section>

		<!-- 文档 -->
		<section>
			<h2 class="mb-3 flex items-center gap-2 font-heading text-lg font-semibold"><BookMarked class="size-5 text-primary" /> 文档（{data.content.docs.length}）</h2>
			{#if data.content.docs.length}
				<div class="flex flex-col divide-y divide-border/40 rounded-xl border border-border/60">
					{#each data.content.docs as d (d.slug)}
						<a href="/docs/{d.slug}" class="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-accent/40">
							<span class="truncate text-sm font-medium">{d.title}</span>
							<span class="shrink-0 text-xs text-muted-foreground">{d.date}</span>
						</a>
					{/each}
				</div>
			{:else}<p class="text-sm text-muted-foreground">暂无发布。</p>{/if}
		</section>
	</div>
</Container>
