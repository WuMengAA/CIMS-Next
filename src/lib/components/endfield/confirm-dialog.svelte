<script lang="ts">
	// 还原截图 02：红警示条 + 双按钮确认（红=危险/不可逆，黄=稳妥主操作）。
	// 遵循 skill：红色只给删除/不可逆动作；黄块墨字做填充。
	let {
		open = false,
		flag = "",
		title,
		message = "",
		dangerLabel = "强制切换",
		safeLabel = "保持原设置",
		onDanger,
		onSafe,
		onClose
	}: {
		open?: boolean;
		flag?: string;
		title: string;
		message?: string;
		dangerLabel?: string;
		safeLabel?: string;
		onDanger?: () => void;
		onSafe?: () => void;
		onClose?: () => void;
	} = $props();

	function key(e: KeyboardEvent) {
		if (e.key === "Escape") onClose?.();
	}
</script>

<svelte:window on:keydown={key} />

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="scrim" role="presentation" onclick={onClose}>
		<div
			class="box"
			role="dialog"
			aria-modal="true"
			aria-label={title}
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
		>
			{#if flag}<div class="flagline">{flag}</div>{/if}
			<button class="x" type="button" onclick={onClose} aria-label="关闭">✕</button>
			<div class="body">
				<h2>{title}</h2>
				{#if message}<p>{message}</p>{/if}
			</div>
			<div class="acts">
				<button class="danger" type="button" onclick={onDanger}>{dangerLabel} <span aria-hidden="true">!</span></button>
				<button class="go" type="button" onclick={onSafe}>{safeLabel} <span aria-hidden="true">✓</span></button>
			</div>
		</div>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 80;
		display: grid;
		place-items: center;
		padding: 1rem;
		background: color-mix(in srgb, var(--ex-ink, #161616) 50%, transparent);
	}
	.box {
		position: relative;
		width: 100%;
		max-width: 33rem;
		background: var(--ex-panel, #ffffff);
		color: var(--ex-ink, #161616);
		border: 1px solid var(--ex-ink, #161616);
		display: flex;
		flex-direction: column;
		animation: ex-drop 0.28s var(--ex-mech, cubic-bezier(0.7, 0, 0.2, 1));
	}
	.flagline {
		background: var(--ex-danger, #b3261e);
		color: #fff;
		font-family: var(--ex-font-ui, inherit);
		font-weight: 700;
		font-size: 0.72rem;
		letter-spacing: 0.06em;
		text-align: center;
		padding: 0.5rem 1rem;
	}
	.x {
		position: absolute;
		top: 0.4rem;
		right: 0.55rem;
		background: none;
		border: 0;
		color: var(--ex-ink-2, #5c5c5c);
		font-size: 0.9rem;
		cursor: pointer;
		padding: 0.35rem;
	}
	.x:hover {
		color: var(--ex-ink, #161616);
	}
	.body {
		padding: 2.1rem 2rem 1.4rem;
		text-align: center;
	}
	.body h2 {
		margin: 0;
		font-family: var(--ex-font-ui, inherit);
		font-weight: 800;
		font-size: 1.12rem;
		letter-spacing: 0.01em;
	}
	.body p {
		margin: 0.7rem 0 0;
		font-size: 0.8rem;
		line-height: 1.6;
		color: var(--ex-ink-2, #5c5c5c);
	}
	.acts {
		display: flex;
		gap: 0.7rem;
		justify-content: center;
		padding: 0 2rem 2rem;
	}
	.acts button {
		font-family: var(--ex-font-ui, inherit);
		font-weight: 700;
		font-size: 0.82rem;
		padding: 0.62rem 1.4rem;
		border: 0;
		cursor: pointer;
		transition: transform 0.12s var(--ex-mech, cubic-bezier(0.7, 0, 0.2, 1)), background 0.16s;
	}
	.acts button:active {
		transform: translateY(1px) scale(0.985);
	}
	.danger {
		background: var(--ex-danger, #b3261e);
		color: #fff;
		clip-path: polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%);
	}
	.danger:hover {
		filter: brightness(1.06);
	}
	.go {
		background: var(--ex-signal, #fffa00);
		color: var(--ex-on-signal, #161616);
		border: 1px solid var(--ex-ink, #161616) !important;
		clip-path: polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%);
	}
	.go:hover {
		filter: brightness(0.98);
	}
	@keyframes ex-drop {
		from {
			opacity: 0;
			transform: translateY(-8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.box {
			animation: none;
		}
	}
</style>
