<script lang="ts">
	import { onMount } from "svelte";
	import { Megaphone, X, Info, CheckCircle2, AlertTriangle, AlertOctagon } from "@lucide/svelte";

	interface Ann { id: string; title: string; content: string; level: string; }
	let items = $state<Ann[]>([]);

	/* 文字色必须分主题给。
	   原先只有 text-*-100（近乎白的浅色），那是**深色专用**：底是 *-500/10，
	   深色主题下是一层极淡的色块，浅色文字刚好读得清；换成亮色主题，
	   同一层 10% 色块落在 #faf9f5 上仍是浅底 —— 浅字压浅底，整条公告等于隐形。
	   做法：亮色用 700 档（深），深色保留 100 档，靠 dark: 变体切换。
	   边框 500/40 在两种底色上都够显眼，不用改。 */
	const LEVEL_STYLE: Record<string, { cls: string; Icon: any }> = {
		info: { cls: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-100", Icon: Info },
		success: { cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-100", Icon: CheckCircle2 },
		warning: { cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-100", Icon: AlertTriangle },
		danger: { cls: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-100", Icon: AlertOctagon }
	};

	function dismissed(id: string): boolean {
		try {
			return JSON.parse(localStorage.getItem("dismissed_ann") || "[]").includes(id);
		} catch {
			return false;
		}
	}
	function dismiss(id: string) {
		try {
			const arr = JSON.parse(localStorage.getItem("dismissed_ann") || "[]");
			arr.push(id);
			localStorage.setItem("dismissed_ann", JSON.stringify(arr));
		} catch { /* noop */ }
		items = items.filter(a => a.id !== id);
	}

	async function load() {
		try {
			const res = await fetch("/api/announcements");
			if (res.ok) {
				const all: Ann[] = await res.json();
				items = all.filter(a => !dismissed(a.id));
			}
		} catch { /* noop */ }
	}
	onMount(load);
</script>

{#if items.length > 0}
	<div class="space-y-2 border-b border-border/40 px-4 py-3 md:px-8">
		{#each items as a (a.id)}
			{@const s = LEVEL_STYLE[a.level] || LEVEL_STYLE.info}
			{@const Icon = s.Icon}
			<div class="flex items-start gap-3 rounded-lg border px-4 py-3 {s.cls}">
				<Icon class="mt-0.5 size-4 shrink-0" />
				<div class="min-w-0 flex-1">
					<p class="text-sm font-medium break-words">{a.title}</p>
					{#if a.content}
						<p class="mt-0.5 whitespace-pre-wrap text-sm break-words opacity-90">{a.content}</p>
					{/if}
				</div>
				<button onclick={() => dismiss(a.id)} class="shrink-0 rounded p-1 opacity-70 transition-opacity hover:opacity-100" aria-label="关闭公告">
					<X class="size-4" />
				</button>
			</div>
		{/each}
	</div>
{/if}
