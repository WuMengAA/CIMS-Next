<script lang="ts">
	import { ROLE_LABELS, type Role } from "$lib/permissions.js";

	// 集控面板以全屏 iframe 嵌入（static/console/index.html）。
	// 面板内已做内嵌自适应：当带 embed=1 时，自动以 /api/console/cims 作为 CIMS 代理基址、
	// 以 /api/console/ext 作为协作数据基址，跳过自身登录、直接复用网站会话。
	// 角色与权限位经 query 下发，面板据此禁用/隐藏无权操作（服务端另有硬校验，前端只是体验层）。
	let { data } = $props<{
		data: {
			role: string;
			user: string;
			email: string;
			avatar: string;
			className: string;
			gradeName: string;
			accountId: string;
			can: { control: boolean; remote: boolean; manage: boolean; issue: boolean };
		};
	}>();

	const roleLabel = $derived(ROLE_LABELS[data.role as Role] || data.role);

	const frameSrc = $derived.by(() => {
		const q = new URLSearchParams({
			embed: "1",
			role: data.role,
			roleLabel,
			user: data.user,
			email: data.email,
			avatar: data.avatar,
			className: data.className,
			gradeName: data.gradeName,
			accountId: data.accountId,
			control: data.can.control ? "1" : "0",
			remote: data.can.remote ? "1" : "0",
			manage: data.can.manage ? "1" : "0",
			issue: data.can.issue ? "1" : "0"
		});
		return "/console/index.html?" + q.toString();
	});

	// 浮动返回按钮：便于退出集控回到后台；Esc 同效（焦点在 iframe 内时由面板自己处理）。
	function back() {
		window.location.href = "/admin";
	}
	function onKey(e: KeyboardEvent) {
		if (e.key === "Escape") back();
	}
</script>

<svelte:window onkeydown={onKey} />

<svelte:head>
	<title>集控面板 · Stelarith</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="console-root">
	<div class="bar">
		<button class="back" onclick={back} title="返回后台（Esc）">← 返回后台</button>
		<span class="who">
			{data.user} · {roleLabel}
			<span class="perm">
				{data.can.control ? "设备控制" : ""}{data.can.control && (data.can.remote || data.can.manage) ? " / " : ""}{data.can.remote ? "远程控制" : ""}{data.can.remote && data.can.manage ? " / " : ""}{data.can.manage ? "设备管理" : ""}{!data.can.control && !data.can.remote && !data.can.manage ? "仅查看" : ""}
			</span>
		</span>
	</div>
	<iframe class="console-frame" src={frameSrc} title="星集控面板"></iframe>
</div>

<style>
	.console-root {
		position: fixed;
		inset: 0;
		z-index: 1000;
		background: var(--background, #1b1b19);
		display: flex;
		flex-direction: column;
	}
	/* 顶部细条：返回入口 + 当前身份与权限。统一走 website 暖调 token（layout.css 提供）。 */
	.bar {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 10px;
		background: var(--sidebar, #141413);
		border-bottom: 1px solid var(--border, oklch(100% 0 0 / 0.24));
		font-size: 12px;
		color: var(--muted-foreground, #b0aea5);
	}
	.who {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.perm {
		padding: 2px 8px;
		border-radius: 999px;
		background: var(--accent, oklch(30% 0.004 106.6));
		color: var(--muted-foreground, #b0aea5);
	}
	.console-frame {
		flex: 1;
		width: 100%;
		min-height: 0;
		border: 0;
		display: block;
	}
	.back {
		padding: 5px 12px;
		border-radius: 8px;
		border: 1px solid var(--border, oklch(100% 0 0 / 0.24));
		background: var(--card, oklch(28% 0.004 106.6));
		color: var(--foreground, #faf9f5);
		cursor: pointer;
		font-size: 12px;
		transition: border-color 0.2s, background 0.2s;
	}
	.back:hover {
		border-color: var(--primary, #cc785c);
	}
	.back:focus-visible {
		outline: 2px solid var(--primary, #cc785c);
		outline-offset: 2px;
	}
	/* 手机端：外层返回条曾折成两行、把面板顶栏挤下去。
	   窄屏只留「返回 + 身份」，权限标签让位（面板内已有权限提示与门控）。 */
	.back {
		white-space: nowrap;
	}
	@media (max-width: 600px) {
		.bar {
			padding: 4px 8px;
			gap: 6px;
			font-size: 11px;
		}
		.who {
			gap: 6px;
		}
		.perm {
			display: none;
		}
	}
</style>
