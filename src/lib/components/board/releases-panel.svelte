<script lang="ts">
	/**
	 * 发行与下载面板。
	 *
	 * 下载走 `/api/project-board/download?slug=&id=`（服务端计数后 302），
	 * 而不是把 /uploads/xxx 直接写进 href —— 否则「下载次数」永远是 0。
	 *
	 * source 徽标区分「站内上传」与「从 GitHub 发行同步」：前者是我们托管的文件，
	 * 后者只是外链，两者的可信度与可用性不同，用户有权知道自己在下载什么。
	 */
	import { Download, Tag, Package, ExternalLink } from "@lucide/svelte";
	import { Badge } from "$lib/components/ui/badge/index.js";

	export interface Release {
		id: string;
		tag: string;
		name: string;
		notes: string;
		file: string;
		url: string;
		size: number;
		createdAt: string;
		downloads: number;
		prerelease: boolean;
		source: "local" | "github";
	}

	let { slug = "", releases = [] }: { slug?: string; releases?: Release[] } = $props();

	function humanSize(n: number): string {
		if (!n) return "—";
		const u = ["B", "KB", "MB", "GB"];
		let i = 0;
		let v = n;
		while (v >= 1024 && i < u.length - 1) {
			v /= 1024;
			i++;
		}
		return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
	}

	function fmt(iso: string): string {
		if (!iso) return "";
		try {
			return new Date(iso).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
		} catch {
			return iso.slice(0, 10);
		}
	}

	function downloadHref(r: Release): string {
		return `/api/project-board/download?slug=${encodeURIComponent(slug)}&id=${encodeURIComponent(r.id)}`;
	}
</script>

<div class="rounded-xl border border-border/60 bg-card">
	<header class="flex items-center gap-2 border-b border-border/40 px-4 py-3">
		<Package class="size-4 text-primary" />
		<h3 class="font-heading text-sm font-medium">发行与下载</h3>
		<Badge variant="outline" class="ml-auto">{releases.length}</Badge>
	</header>

	{#if releases.length === 0}
		<p class="px-4 py-8 text-center text-sm text-muted-foreground">还没有发布任何发行版。</p>
	{:else}
		<ul class="divide-y divide-border/40">
			{#each releases as r (r.id)}
				<li class="px-4 py-3">
					<div class="flex flex-wrap items-center gap-2">
						<Tag class="size-3.5 shrink-0 text-muted-foreground" />
						<span class="font-medium">{r.name || r.tag}</span>
						<span class="rounded border border-border px-1.5 py-px font-mono text-[10px] text-muted-foreground">{r.tag}</span>
						{#if r.prerelease}
							<span class="rounded-full border border-amber-500/50 px-1.5 py-px text-[10px] text-amber-600 dark:text-amber-400">预发布</span>
						{/if}
						{#if r.source === "github"}
							<span class="rounded-full border border-border px-1.5 py-px text-[10px] text-muted-foreground">GitHub</span>
						{/if}
						<span class="ml-auto text-xs text-muted-foreground">{fmt(r.createdAt)}</span>
					</div>

					{#if r.notes}
						<p class="mt-1.5 line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">{r.notes}</p>
					{/if}

					<div class="mt-2 flex flex-wrap items-center gap-3">
						{#if r.url || r.file}
							<a
								href={downloadHref(r)}
								class="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1 text-xs transition-colors hover:border-primary/50 hover:text-primary"
							>
								<Download class="size-3.5" />
								下载
								<span class="text-muted-foreground">({humanSize(r.size)})</span>
							</a>
						{:else}
							<span class="text-xs text-muted-foreground">无下载文件</span>
						{/if}
						{#if r.downloads > 0}
							<span class="text-xs text-muted-foreground">已下载 {r.downloads} 次</span>
						{/if}
						{#if r.source === "github" && r.url}
							<a
								href={r.url}
								target="_blank"
								rel="noopener noreferrer"
								class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
							><ExternalLink class="size-3" />在 GitHub 查看</a>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>
