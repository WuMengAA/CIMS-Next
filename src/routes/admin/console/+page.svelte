<script lang="ts">
	import { page } from "$app/state";

	// 集控面板以全屏 iframe 嵌入（static/console/index.html）。
	// 面板内已做内嵌自适应：当路径为 /admin/console 时，自动以 /api/console/cims 作为 CIMS 代理基址，
	// 跳过自身登录、直接复用网站会话（CIMS 凭据由服务端代理持有）。
	let { data } = $props<{ data: { role: string; can: { control: boolean; remote: boolean; manage: boolean } } }>();

	// 浮动返回按钮：覆盖在面板之上，便于退出集控回到后台。
	function back() {
		window.location.href = "/admin";
	}
</script>

<svelte:head>
	<title>集控面板 · Stelarith</title>
</svelte:head>

<div class="console-root">
	<button class="back" onclick={back} title="返回后台">← 返回</button>
	<iframe class="console-frame" src="/console/index.html" title="星集控面板"></iframe>
</div>

<style>
	.console-root {
		position: fixed;
		inset: 0;
		z-index: 1000;
		background: #0e0e0c;
	}
	.console-frame {
		width: 100%;
		height: 100%;
		border: 0;
		display: block;
	}
	.back {
		position: fixed;
		top: 10px;
		left: 10px;
		z-index: 1001;
		padding: 6px 12px;
		border-radius: 8px;
		border: 1px solid #444;
		background: rgba(20, 20, 18, 0.85);
		color: #e8e6e1;
		cursor: pointer;
		font-size: 13px;
	}
	.back:hover {
		background: rgba(40, 40, 36, 0.95);
	}
</style>
