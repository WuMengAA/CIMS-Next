<script lang="ts">
	import { ROLE_LABELS, type Role } from "$lib/permissions.js";
	import { browser } from "$app/environment";
	import { onMount } from "svelte";

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
			can: { control: boolean; remote: boolean; manage: boolean; issue: boolean };
			broadcastScopes: string[];
			userId: number;
		};
	}>();

	const roleLabel = $derived(ROLE_LABELS[data.role as Role] || data.role);

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

		// 高度兜底（确定方案）：右侧 Sidebar.Content 是 flex-1 但实测会被内部塌缩内容拉低到
		// 150px（iframe 默认高），absolute/flex 子元素都只能拿到 150 → 面板扁。而外层
		// Sidebar.Inset 高度确定（=视口高，position:relative）。故直接把 .console-root 绝对
		// 定位到 Inset，顶部让出后台顶栏，彻底绕过塌缩的 Content。Content 改 static 让 abs
		// 越过它去找 Inset（否则 abs 会相对 Content 的 150 高）。ResizeObserver 跟随顶栏/
		// 窗口变化重算 top。
		const root = document.querySelector(".console-root");
		const content = root?.closest('[data-slot="sidebar-content"]') as HTMLElement | null;
		const inset = document.querySelector('[data-slot="sidebar-inset"]') as HTMLElement | null;
		if (content) content.style.position = "static";
		const apply = () => {
			if (root && inset) {
				const top = (inset.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0;
				const insetRect = inset.getBoundingClientRect();
				// 内容区的左偏移 = 左侧 CMS 侧栏宽度（桌面 256；移动端侧栏是浮层，
				// content 为 null → left 归 0，面板占满整宽）。用真实测量而非硬编码，
				// 跟随侧栏折叠/响应式。
				const left = content ? Math.max(0, content.getBoundingClientRect().left - insetRect.left) : 0;
				root.style.position = "absolute";
				root.style.top = top + "px";
				root.style.left = left + "px";
				root.style.right = "0";
				root.style.bottom = "auto";
				root.style.height = inset.clientHeight - top + "px";
			}
		};
		apply();
		const ro = new ResizeObserver(apply);
		if (inset) ro.observe(inset);
		window.addEventListener("resize", apply);

		return () => {
			mo.disconnect();
			ro.disconnect();
			window.removeEventListener("resize", apply);
			if (content) content.style.position = "";
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

<!-- 撑满后台内容区：实测右侧 Sidebar.Content(flex-1) 会被内部塌缩内容拉低到 150px
     （iframe 默认高），absolute/flex 子元素都只能拿到 150 → 面板扁。而外层 Sidebar.Inset
     高度确定（=视口高，position:relative）。故 .console-root 走 position:absolute，由
     onMount 的 JS 直接相对 Inset 定位：top=后台顶栏高、left=左侧 CMS 侧栏宽（移动端侧栏
     是浮层→归 0）、height=Inset 高-top。并临时把 Content 改 static，让 abs 越过它去找
     Inset。ResizeObserver 跟随顶栏/窗口变化重算。这彻底绕开塌缩的 Content 高度链。面板
     内部自带顶栏/侧栏/状态栏，全高铺开。 -->
<div class="console-root">
	<iframe bind:this={frameEl} class="console-frame" src={frameSrc} title="星集控面板"></iframe>
</div>

<style>
	.console-root {
		position: absolute;
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
</style>
