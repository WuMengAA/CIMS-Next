<script lang="ts">
	/**
	 * 新版本提示条（参考 acofork 内容更新机制的网页版）：
	 * 页面加载时记下构建期 commit，之后每 60s / 页面重新可见时
	 * 拉一次 /api/version；commit 变了 = 站点换了新部署，
	 * 底部出条提示「点击刷新体验」，不自动刷（避免丢用户正在写的表单）。
	 */
	import { onMount } from "svelte";
	import { CONTENT_COMMIT } from "virtual:stelarith-version";

	const POLL_MS = 60_000;
	let latest = $state<string | null>(null);
	let dismissed = $state(false);

	onMount(() => {
		if (CONTENT_COMMIT === "dev") return; // 本地无 git 环境，不提示
		let timer: ReturnType<typeof setInterval> | undefined;

		async function check() {
			try {
				const res = await fetch("/api/version", { cache: "no-store" });
				if (!res.ok) return;
				const data = (await res.json()) as { commit?: string };
				if (data.commit && data.commit !== CONTENT_COMMIT) {
					latest = data.commit;
				}
			} catch {
				/* 网络失败静默：下次轮询再试 */
			}
		}

		timer = setInterval(check, POLL_MS);
		document.addEventListener("visibilitychange", onVisible);
		return () => {
			clearInterval(timer);
			document.removeEventListener("visibilitychange", onVisible);
		};

		function onVisible() {
			if (document.visibilityState === "visible") check();
		}
	});
</script>

{#if latest && !dismissed}
	<div
		class="fixed inset-x-0 bottom-0 z-50 flex items-center justify-center gap-3 border-t border-border bg-card/95 px-4 py-2 text-xs text-muted-foreground shadow-lg backdrop-blur"
		role="status"
	>
		<span class="hidden sm:inline">发现新版本</span>
		<span class="font-mono text-[11px]">{CONTENT_COMMIT} → {latest}</span>
		<button
			type="button"
			class="rounded-[3px] bg-primary px-2 py-1 font-medium text-primary-foreground transition-opacity hover:opacity-85"
			onclick={() => location.reload()}
		>
			点击刷新体验
		</button>
		<button
			type="button"
			class="text-muted-foreground transition-colors hover:text-foreground"
			aria-label="关闭更新提示"
			onclick={() => (dismissed = true)}
		>
			✕
		</button>
	</div>
{/if}
