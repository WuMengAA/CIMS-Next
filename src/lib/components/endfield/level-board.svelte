<script lang="ts">
	// 还原截图 05：等阶晋升看板 —— 大等阶数字 + 进度 + 等距卡片堆 + 等阶阶梯 + 提升奖励。
	// 站点适配：用纸/墨/黄调；卡片堆用 CSS 3D 等距，不搬任何游戏素材。
	let {
		eyebrow = "Rank / 等阶晋升",
		title = "当前等阶",
		level = 3,
		cur = 80,
		max = 720,
		tiers = [9, 8, 7, 6, 5, 4, 3, 2, 1] as number[],
		rewardLabel = "理能上限提升",
		rewardFrom = 130,
		rewardTo = 135
	}: {
		eyebrow?: string;
		title?: string;
		level?: number;
		cur?: number;
		max?: number;
		tiers?: number[];
		rewardLabel?: string;
		rewardFrom?: number;
		rewardTo?: number;
	} = $props();

	const pct = $derived(Math.max(0, Math.min(1, max > 0 ? cur / max : 0)));
	const top = $derived(tiers[0] ?? level);
</script>

<div class="ex-level">
	<div class="meta">
		<p class="eyebrow">{eyebrow}</p>
		<p class="cap">{title}</p>
		<div class="lvl">
			<span class="big">{level}</span>
			<span class="of">/ {top}</span>
		</div>
		<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax={max} aria-valuenow={cur}>
			<i style="width:{pct * 100}%"></i>
		</div>
		<p class="nums">{cur} / {max}</p>
	</div>

	<div class="stage" aria-hidden="true">
		<div class="stack">
			{#each [0, 1, 2, 3] as k (k)}
				<span class="card" style="--k:{k}"></span>
			{/each}
		</div>
	</div>

	<div class="ladder">
		<ul aria-hidden="true">
			{#each tiers as t (t)}
				<li class:cur={t === level}>{t}</li>
			{/each}
		</ul>
		<div class="reward">
			<span class="rl">{rewardLabel}</span>
			<span class="rv">{rewardFrom} <span aria-hidden="true">→</span> {rewardTo}</span>
		</div>
	</div>
</div>

<style>
	.ex-level {
		display: grid;
		grid-template-columns: 1fr 1.3fr 0.7fr;
		gap: 1.5rem;
		align-items: stretch;
		background: var(--ex-panel, #ffffff);
		border: 1px solid var(--ex-rule, #d9d9d6);
		padding: 1.6rem 1.7rem;
	}
	.eyebrow {
		margin: 0;
		font-family: var(--ex-font-ui, inherit);
		font-size: 0.66rem;
		font-weight: 600;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--ex-ink-2, #5c5c5c);
	}
	.cap {
		margin: 0.5rem 0 0;
		font-size: 0.82rem;
		color: var(--ex-ink-2, #5c5c5c);
	}
	.lvl {
		display: flex;
		align-items: baseline;
		gap: 0.35rem;
		margin-top: 0.25rem;
	}
	.big {
		font-family: var(--ex-font-ui, inherit);
		font-weight: 800;
		font-size: 3.4rem;
		line-height: 0.9;
		color: var(--ex-ink, #161616);
		font-variant-numeric: tabular-nums;
	}
	.of {
		font-family: var(--ex-font-ui, inherit);
		font-weight: 600;
		font-size: 0.9rem;
		color: var(--ex-ink-2, #5c5c5c);
	}
	.bar {
		margin-top: 1rem;
		height: 4px;
		width: 100%;
		background: var(--ex-chip, #e4e4e0);
		overflow: hidden;
	}
	.bar i {
		display: block;
		height: 100%;
		background: var(--ex-signal, #fffa00);
		transition: width 0.5s var(--ex-mech, cubic-bezier(0.7, 0, 0.2, 1));
	}
	.nums {
		margin: 0.5rem 0 0;
		font-family: var(--ex-font-ui, inherit);
		font-size: 0.72rem;
		font-stretch: 112%;
		color: var(--ex-ink-2, #5c5c5c);
		font-variant-numeric: tabular-nums;
	}
	.stage {
		perspective: 1000px;
		display: grid;
		place-items: center;
		min-height: 12rem;
	}
	.stack {
		position: relative;
		width: 8rem;
		height: 8rem;
		transform-style: preserve-3d;
	}
	.card {
		position: absolute;
		width: 9rem;
		height: 9rem;
		background: var(--ex-paper, #f4f4f2);
		border: 1.5px solid var(--ex-ink, #161616);
		transform: rotateX(56deg) rotateZ(-42deg)
			translate3d(calc(var(--k) * 1.45rem), calc(var(--k) * -1.45rem), calc(var(--k) * 1.7rem));
	}
	.card::before {
		content: "";
		position: absolute;
		left: 14%;
		right: 14%;
		top: 9%;
		height: 32%;
		border-top: 3px solid var(--ex-signal, #fffa00);
		border-radius: 50% 50% 0 0 / 72% 72% 0 0;
	}
	.ladder {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		align-items: flex-end;
		text-align: right;
	}
	.ladder ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.ladder li {
		font-family: var(--ex-font-ui, inherit);
		font-size: 0.85rem;
		color: var(--ex-ink-2, #5c5c5c);
		font-variant-numeric: tabular-nums;
		padding: 0 0.35rem;
	}
	.ladder li.cur {
		color: var(--ex-ink, #161616);
		background: var(--ex-signal, #fffa00);
		font-weight: 800;
	}
	.reward {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		border-top: 1px solid var(--ex-rule, #d9d9d6);
		padding-top: 0.6rem;
		width: 100%;
	}
	.rl {
		font-size: 0.68rem;
		color: var(--ex-ink-2, #5c5c5c);
	}
	.rv {
		font-family: var(--ex-font-ui, inherit);
		font-weight: 700;
		font-size: 0.95rem;
		color: var(--ex-ink, #161616);
		font-variant-numeric: tabular-nums;
	}
	@media (max-width: 767px) {
		.ex-level {
			grid-template-columns: 1fr;
		}
		.ladder {
			align-items: flex-start;
			text-align: left;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.bar i {
			transition: none;
		}
	}
</style>
