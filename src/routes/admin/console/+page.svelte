<script lang="ts">
	import { ROLE_LABELS, type Role } from "$lib/permissions.js";
	import { ArrowLeft, Eye, ShieldCheck } from "@lucide/svelte";

	// 集控面板以全屏 iframe 嵌入（static/console/index.html）。
	// 面板内已做内嵌自适应：当带 embed=1 时，自动以 /api/console/cims 作为 CIMS 代理基址、
	// 以 /api/console/ext 作为协作数据基址，跳过自身登录、直接复用网站会话。
	// 角色、等级与权限位经 query 下发，面板据此禁用/隐藏无权操作
	// （服务端另有硬校验，前端只是体验层）。
	//
	// 权限位分两条互相独立的轴下发：
	//  - control/remote/manage 属「设备轴」——与内容等级无关，电教委员 L2 也可能有 remote；
	//  - readonly 表示整体只读观看态，面板据此隐藏全部写操作入口。
	let { data } = $props<{
		data: {
			role: string;
			levelLabel: string;
			readonly: boolean;
			user: string;
			email: string;
			avatar: string;
			className: string;
			gradeName: string;
			accountId: string;
			can: { control: boolean; remote: boolean; manage: boolean; issue: boolean };
			broadcastScopes: string[];
			userId: number;
		};
	}>();

	const roleLabel = $derived(ROLE_LABELS[data.role as Role] || data.role);

	const frameSrc = $derived.by(() => {
		const q = new URLSearchParams({
			embed: "1",
			role: data.role,
			roleLabel,
			levelLabel: data.levelLabel,
			user: data.user,
			email: data.email,
			avatar: data.avatar,
			className: data.className,
			gradeName: data.gradeName,
			accountId: data.accountId,
			control: data.can.control ? "1" : "0",
			remote: data.can.remote ? "1" : "0",
			manage: data.can.manage ? "1" : "0",
			issue: data.can.issue ? "1" : "0",
			readonly: data.readonly ? "1" : "0",
			// 广播可达范围（class/grade/school）逗号分隔：面板据此只列可选范围
			bscopes: (data.broadcastScopes || []).join(","),
			// 当前用户 id：面板拼一对一私聊房间名用（dm:<小id>:<大id>）
			uid: String(data.userId ?? "")
		});
		return "/console/index.html?" + q.toString();
	});

	// 当前持有的设备权限档位文案（含"仅查看"兜底）。
	const permText = $derived.by(() => {
		const t: string[] = [];
		if (data.can.control) t.push("设备控制");
		if (data.can.remote) t.push("远程控制");
		if (data.can.manage) t.push("设备管理");
		return t.length ? t.join(" / ") : "仅查看";
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
	<!-- 宿主顶条：返回入口 + 当前身份/等级/设备权限。
	     按键位置统一为「左：导航类动作（返回）；右：状态与身份」，
	     与后台顶栏（左标题、右操作）保持同一条心智线。 -->
	<div class="bar">
		<button class="back" onclick={back} title="返回后台（Esc）">
			<ArrowLeft class="size-3.5" />
			<span>返回后台</span>
		</button>
		<!-- 只读徽标：放在左侧导航之后、身份之前，扫一眼就知道自己没有写权限 -->
		{#if data.readonly}
			<span class="tag readonly" title="当前权限为只读观看，所有设备写操作已隐藏">
				<Eye class="size-3" />
				只读观看
			</span>
		{/if}
		<span class="who">
			<span class="identity">{data.user}</span>
			<span class="sep">·</span>
			<span class="role">{roleLabel}</span>
			<span class="perm" title="设备权限档位（与内容等级独立）">
				<ShieldCheck class="size-3" />
				{permText}
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
		gap: 8px;
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
		gap: 6px;
		min-width: 0;
	}
	.identity {
		color: var(--foreground, #faf9f5);
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 12ch;
	}
	.sep {
		opacity: 0.45;
	}
	.role {
		white-space: nowrap;
	}
	.perm {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 8px;
		border-radius: 999px;
		background: var(--accent, oklch(30% 0.004 106.6));
		color: var(--muted-foreground, #b0aea5);
		white-space: nowrap;
	}
	/* 只读徽标：用主色描边区别于普通权限标签，视觉上"很轻但看得见" */
	.tag.readonly {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 8px;
		border-radius: 999px;
		border: 1px solid var(--primary, #cc785c);
		color: var(--primary, #cc785c);
		white-space: nowrap;
	}
	.console-frame {
		flex: 1;
		width: 100%;
		min-height: 0;
		border: 0;
		display: block;
	}
	.back {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 5px 12px;
		border-radius: 8px;
		border: 1px solid var(--border, oklch(100% 0 0 / 0.24));
		background: var(--card, oklch(28% 0.004 106.6));
		color: var(--foreground, #faf9f5);
		cursor: pointer;
		font-size: 12px;
		white-space: nowrap;
		/* 按键反馈：hover 抬边、按下微缩，给出明确的"点到了"的触感 */
		transition: border-color 0.2s, background 0.2s, transform 0.12s ease;
	}
	.back:hover {
		border-color: var(--primary, #cc785c);
	}
	.back:active {
		transform: scale(0.96);
	}
	.back:focus-visible {
		outline: 2px solid var(--primary, #cc785c);
		outline-offset: 2px;
	}
	/* 手机端：外层返回条曾折成两行、把面板顶栏挤下去。
	   窄屏只留「返回 + 身份」，权限与角色标签让位（面板内已有权限提示与门控）。 */
	@media (max-width: 640px) {
		.bar {
			padding: 4px 8px;
			gap: 6px;
			font-size: 11px;
		}
		.who {
			gap: 5px;
		}
		.perm,
		.role,
		.sep {
			display: none;
		}
		.identity {
			max-width: 9ch;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.back {
			transition: border-color 0.2s, background 0.2s;
		}
		.back:active {
			transform: none;
		}
	}
</style>
