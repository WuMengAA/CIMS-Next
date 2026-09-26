<script lang="ts">
	import { ROLE_LABELS, type Role } from "$lib/permissions.js";
	import { browser } from "$app/environment";
	import { onMount } from "svelte";
	import TeacherQr from "$lib/components/teacher-qr.svelte";

	// 集控面板以 iframe 嵌入 static/console/index.html，作为后台内容区的一页
	// （不再全屏接管）：由后台外壳提供侧栏 + 顶栏 + 账号体系；面板自身仍带一套完整的
	// 顶栏 / 左侧设备导航 / 状态栏，其内容是设备级功能，与网站 CMS 导航是两个维度，
	// 故双重侧栏是预期的，不是 bug。
	// embed=1 时面板自动以 /api/console/cims 作 CIMS 代理基址、以 /api/console/ext
	// 作协作数据基址，跳过自身登录、直接复用网站会话（服务端另有硬校验）。
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
			can: { control: boolean; remote: boolean; manage: boolean; issue: boolean; broadcast: boolean };
			broadcastScopes: string[];
			userId: number;
			lanHost: string;
		};
	}>();

	const roleLabel = $derived(ROLE_LABELS[data.role as Role] || data.role);
	// 老师手机页二维码弹窗（T09 第二步）：浮动入口 → 扫码直达 /teacher（PWA 套壳）
	let qrOpen = $state(false);

	// 主题跟随：官网用 ModeWatcher，主题反映在 <html> 的 `dark` 类上。面板是独立
	// iframe 文档，读不到父文档 class，故这里把当前主题经 ?theme= 注入初始 src，
	// 并在切换时用 postMessage 实时同步（避免整体 reload 丢失视图状态）。
	let theme = $state<string>(browser && document.documentElement.classList.contains("dark") ? "dark" : "light");
	let frameEl = $state<HTMLIFrameElement | null>(null);

	onMount(() => {
		theme = document.documentElement.classList.contains("dark") ? "dark" : "light";
		const mo = new MutationObserver(() => {
			const t = document.documentElement.classList.contains("dark") ? "dark" : "light";
			if (t !== theme) theme = t;
		});
		mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

		// 高度撑满（确定方案）：position:fixed 框住「后台内容区」——左/右/上边界取内嵌
		// sidebar-inset 的 sidebar-content 左缘与内嵌顶栏底边，宽/高用该 content 的宽与
		// 视口高。完全不依赖会塌缩的 flex 内容链（#main-content 是普通 div，在 flex-col 的
		// Inset 里不撑开，整条链被拉到 150px → 面板扁）；fixed 相对视口、测量值取确定宽度
		// 与视口高，免疫塌缩。注意：左侧 CMS 侧栏是 [data-slot=sidebar] 外层 wrapper，其子
		// 容器 position:fixed，wrapper 自身 getBoundingClientRect 不可靠（right 会取到视口
		// 右缘），故改用内嵌 content 的 rect 拿 left/width。顶栏/侧栏可能延迟渲染或折叠，
		// 挂载后多算几次兜底。
		const root = document.querySelector(".console-root");
		const adminInset = root?.closest('[data-slot="sidebar-inset"]') as HTMLElement | null;
		const content = adminInset?.querySelector('[data-slot="sidebar-content"]') as HTMLElement | null;
		const header = adminInset?.querySelector('[data-slot="sidebar-header"]') as HTMLElement | null;
		const apply = () => {
			if (!root) return;
			const vh = window.innerHeight;
			const cr = content?.getBoundingClientRect();
			const hr = header?.getBoundingClientRect();
			const top = hr ? hr.bottom : (cr ? cr.top : 0);
			const left = cr ? cr.left : 0;
			const width = cr ? cr.width : window.innerWidth;
			root.style.position = "fixed";
			root.style.top = top + "px";
			root.style.left = left + "px";
			root.style.width = width + "px";
			root.style.height = vh - top + "px";
			root.style.right = "auto";
			root.style.bottom = "auto";
		};
		apply();
		const ro = new ResizeObserver(apply);
		ro.observe(document.body);
		window.addEventListener("resize", apply);
		const t1 = setTimeout(apply, 60);
		const t2 = setTimeout(apply, 250);

		return () => {
			mo.disconnect();
			ro.disconnect();
			window.removeEventListener("resize", apply);
			clearTimeout(t1);
			clearTimeout(t2);
		};
	});

	// 主题变化且 iframe 已存在 → 实时通知（不 reload）
	$effect(() => {
		const t = theme;
		const el = frameEl;
		if (el && el.contentWindow) {
			try {
				el.contentWindow.postMessage({ type: "theme", theme: t }, "*");
			} catch {}
		}
	});

	const frameSrc = $derived.by(() => {
		const q = new URLSearchParams({
			embed: "1",
			theme,
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
			broadcast: data.can.broadcast ? "1" : "0",
			readonly: data.readonly ? "1" : "0",
			// 广播可达范围（class/grade/school）逗号分隔：面板据此只列可选范围
			bscopes: (data.broadcastScopes || []).join(","),
			// 当前用户 id：面板拼一对一私聊房间名用（dm:<小id>:<大id>）
			uid: String(data.userId ?? "")
		});
		return "/console/index.html?" + q.toString();
	});
</script>

<svelte:head>
	<title>集控面板 · Stelarith</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<!-- 撑满后台内容区：用 position:fixed 框住「后台内容区」（CMS 侧栏右缘→视口右缘、
     后台顶栏底边→视口底），偏移用真实元素 getBoundingClientRect、宽高用
     window.innerWidth/innerHeight（永远正确）。不依赖会塌缩的 flex 内容链
     （#main-content 是普通 div，在 flex-col 的 Inset 里不撑开，整条链被拉到 150px → 面板扁）；
     fixed 相对视口、测量值取确定高度的视口，免疫塌缩。面板内部自带顶栏/侧栏/状态栏，全高铺开。 -->
<div class="console-root">
	<iframe bind:this={frameEl} class="console-frame" src={frameSrc} title="星集控面板"></iframe>
</div>

<!-- 老师手机页浮动入口（T09 第二步）：扫码直达 /teacher，手机可"添加到主屏幕"像 App 一样用 -->
<div class="teacher-qr-entry" title="老师手机页：扫码直达（手机同网络即可打开）">
	<button type="button" class="teacher-qr-btn" onclick={() => (qrOpen = true)}>
		<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>
		<span>老师手机页</span>
	</button>
</div>
<TeacherQr bind:open={qrOpen} lanHost={data.lanHost} />

<style>
	.console-root {
		position: fixed;
		inset: 0;
		display: flex;
		flex-direction: column;
		background: var(--background, #1b1b19);
	}
	.console-frame {
		flex: 1 1 auto;
		min-height: 0;
		width: 100%;
		border: 0;
		display: block;
	}
	.teacher-qr-entry {
		position: fixed;
		top: 54px;
		right: 14px;
		z-index: 2000;
	}
	.teacher-qr-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 7px 13px;
		border-radius: 999px;
		background: #e8b23d;
		color: #3a2c08;
		border: none;
		font-weight: 700;
		font-size: 13px;
		cursor: pointer;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.22);
		font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
	}
	.teacher-qr-btn:hover {
		filter: brightness(1.07);
	}
</style>
