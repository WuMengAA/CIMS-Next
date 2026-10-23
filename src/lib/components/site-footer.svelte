<script lang="ts">
	/**
	 * 全站页脚（2026-10-23 版本号体系重构新增）。
	 * 双轨版本展示：站点 semver（package.json）+ 内容版本（git commit）。
	 * 两套皮肤（经典 / 终末地）下都跟随令牌，不写死颜色。
	 */
	import { SITE_VERSION, CONTENT_COMMIT, CONTENT_BUILT_AT } from "virtual:stelarith-version";
</script>

<footer
	class="mt-auto border-t border-border/60 px-4 py-3 text-xs text-muted-foreground md:px-6"
	aria-label="站点页脚"
>
	<div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1">
		<span>© {new Date().getFullYear()} Stelarith</span>
		<span class="hidden sm:inline">·</span>
		<span>
			版本 <a href="/changelog" class="text-foreground underline decoration-primary decoration-2 underline-offset-2 hover:opacity-80">v{SITE_VERSION}</a>
		</span>
		{#if CONTENT_COMMIT !== "dev"}
			<span class="hidden sm:inline">·</span>
			<span class="font-mono text-[11px]" title="内容版本（git commit）">内容 {CONTENT_COMMIT}</span>
		{/if}
		{#if CONTENT_BUILT_AT}
			<span class="hidden md:inline">·</span>
			<span class="hidden md:inline">构建于 {CONTENT_BUILT_AT}</span>
		{/if}
	</div>
</footer>
