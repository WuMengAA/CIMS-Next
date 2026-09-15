<script lang="ts">
	/**
	 * 继续阅读 —— 本地记忆的兑现入口。
	 *
	 * 数据全部来自 localStorage（reading-progress.ts），不发请求：
	 * 首页首屏不应该为了"你上次读到哪"多打一次网络往返。
	 * 也正因为是本地数据，未登录访客同样拥有完整体验。
	 *
	 * 服务端渲染时列表为空（localStorage 不存在），水合后填充 ——
	 * 因此容器高度在两种状态下都要合理，避免水合后布局跳动。
	 */
	import { onMount } from "svelte";
	import { BookMarked, FileText, Rocket, Clock, X, History } from "@lucide/svelte";
	import { getContinueReading, getVisits, removeVisit, type ReadingRecord } from "$lib/reading-progress.js";

	let records = $state<ReadingRecord[]>([]);
	let visits = $state<{ path: string; title: string; at: number }[]>([]);
	let ready = $state(false);
	let tab = $state<"reading" | "recent">("reading");

	const SECTION_ICON: Record<string, any> = {
		posts: FileText, docs: BookMarked, projects: Rocket, pages: FileText
	};

	/** 相对时间：比绝对时间更容易产生"这是我刚才看的"的确认感。 */
	function relTime(ms: number): string {
		const diff = Date.now() - ms;
		const min = Math.floor(diff / 60000);
		if (min < 1) return "刚刚";
		if (min < 60) return `${min} 分钟前`;
		const h = Math.floor(min / 60);
		if (h < 24) return `${h} 小时前`;
		const d = Math.floor(h / 24);
		if (d < 30) return `${d} 天前`;
		return new Date(ms).toLocaleDateString("zh-CN");
	}

	function refresh() {
		records = getContinueReading(4);
		visits = getVisits(6);
		ready = true;
	}

	/** 从「最近浏览」里移除一项（用户主动清理，尊重隐私感）。 */
	function dropVisit(path: string) {
		removeVisit(path);
		visits = getVisits(6);
	}

	onMount(refresh);
</script>

<!-- 无历史时整块不渲染：首访用户看到空壳卡片只会觉得"这站怎么是空的" -->
{#if ready && (records.length > 0 || visits.length > 0)}
	<section class="rounded-xl border border-border/60 bg-card p-4">
		<header class="mb-3 flex items-center justify-between gap-2">
			<div class="flex items-center gap-1">
				<button
					class="rounded-md px-2 py-1 text-xs font-medium transition-colors {tab === 'reading' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}"
					onclick={() => (tab = "reading")}
				>
					<BookMarked class="mr-1 inline size-3.5" />继续阅读
				</button>
				<button
					class="rounded-md px-2 py-1 text-xs font-medium transition-colors {tab === 'recent' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}"
					onclick={() => (tab = "recent")}
				>
					<History class="mr-1 inline size-3.5" />最近浏览
				</button>
			</div>
		</header>

		{#if tab === "reading"}
			{#if records.length === 0}
				<p class="py-3 text-center text-xs text-muted-foreground">暂无未读完的内容</p>
			{:else}
				<ul class="space-y-1">
					{#each records as r (r.target)}
						{@const I = SECTION_ICON[r.section] ?? FileText}
						<li>
							<a
								href={r.href}
								class="group flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-accent"
							>
								<I class="size-4 shrink-0 text-muted-foreground" />
								<span class="min-w-0 flex-1">
									<span class="block truncate text-sm font-medium">{r.title}</span>
									<!-- 进度条：让"还剩多少"一眼可见，而不是只给一个数字 -->
									<span class="mt-1.5 flex items-center gap-2">
										<span class="h-1 flex-1 overflow-hidden rounded-full bg-muted">
											<span class="block h-full rounded-full bg-primary transition-all" style="width: {Math.round(r.progress * 100)}%"></span>
										</span>
										<span class="shrink-0 text-[10px] tabular-nums text-muted-foreground">{Math.round(r.progress * 100)}%</span>
									</span>
								</span>
								<span class="shrink-0 text-[10px] text-muted-foreground">{relTime(r.at)}</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		{:else}
			{#if visits.length === 0}
				<p class="py-3 text-center text-xs text-muted-foreground">暂无浏览记录</p>
			{:else}
				<ul class="space-y-0.5">
					{#each visits as v (v.path)}
						<li class="group flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-accent">
							<Clock class="size-3.5 shrink-0 text-muted-foreground" />
							<a href={v.path} class="min-w-0 flex-1 truncate text-sm hover:text-primary">{v.title || v.path}</a>
							<span class="shrink-0 text-[10px] text-muted-foreground">{relTime(v.at)}</span>
							<button
								class="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
								onclick={() => dropVisit(v.path)}
								aria-label="从记录中移除"
								title="从记录中移除"
							><X class="size-3" /></button>
						</li>
					{/each}
				</ul>
				<p class="mt-2 text-center text-[10px] text-muted-foreground/70">浏览记录仅保存在本机浏览器，不会上传</p>
			{/if}
		{/if}
	</section>
{/if}
