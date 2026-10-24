<script lang="ts">
	// 还原截图 01：五枚箭头加载指示器 + 三点。
	// 加载指示是 skill 允许的"持续动效"例外之一（表示正在进行）。
	let { label = "加载中", count = 5 }: { label?: string; count?: number } = $props();
</script>

<div class="ex-loading" role="status" aria-label={label}>
	<div class="track" aria-hidden="true">
		{#each Array(count) as _, i (i)}
			<span class="chev" style="--i:{i}"></span>
		{/each}
	</div>
	<div class="dots" aria-hidden="true"><i></i><i></i><i></i></div>
</div>

<style>
	.ex-loading {
		display: inline-flex;
		flex-direction: column;
		align-items: center;
		gap: 0.7rem;
	}
	.track {
		display: inline-flex;
		gap: 0.42rem;
		background: var(--ex-paper, #f4f4f2);
		padding: 0.6rem 0.95rem;
	}
	.chev {
		width: 1.15rem;
		height: 1.15rem;
		background: var(--ex-ink, #161616);
		clip-path: polygon(0 0, 42% 0, 100% 50%, 42% 100%, 0 100%, 46% 50%);
		animation: ex-chev 1.05s var(--ex-snap, cubic-bezier(0.16, 1, 0.3, 1)) infinite;
		animation-delay: calc(var(--i) * 85ms);
	}
	.dots {
		display: inline-flex;
		gap: 0.3rem;
	}
	.dots i {
		width: 5px;
		height: 5px;
		background: var(--ex-ink-2, #5c5c5c);
		animation: ex-dot 1.05s linear infinite;
	}
	.dots i:nth-child(2) {
		animation-delay: 0.15s;
	}
	.dots i:nth-child(3) {
		animation-delay: 0.3s;
	}
	@keyframes ex-chev {
		0%,
		100% {
			opacity: 0.22;
			transform: translateX(0);
		}
		45% {
			opacity: 1;
			transform: translateX(2px);
		}
	}
	@keyframes ex-dot {
		0%,
		100% {
			opacity: 0.28;
		}
		50% {
			opacity: 1;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.chev,
		.dots i {
			animation: none;
			opacity: 0.85;
		}
	}
</style>
