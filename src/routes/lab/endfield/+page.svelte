<script lang="ts">
	// 终末地界面还原样张：把加载指示器 / 双按钮确认框 / 等阶晋升看板集中展示，便于对照截图与验收。
	// 数值为示例（样张页），真实页面里这些组件由真实数据驱动。
	import "../../endfield-kit.css";
	import Seo from "$lib/components/Seo.svelte";
	import Container from "$lib/components/container.svelte";
	import Loader from "$lib/components/endfield/loader.svelte";
	import ConfirmDialog from "$lib/components/endfield/confirm-dialog.svelte";
	import LevelBoard from "$lib/components/endfield/level-board.svelte";

	let confirmOpen = $state(false);
	let lastChoice = $state("");
</script>

<Seo title="界面还原样张" description="终末地风味界面还原：加载、确认、等阶、采购中心。" path="/lab/endfield" />

<Container>
	<header class="ex-sheet-head">
		<div>
			<p class="ex-eyebrow slash">Specimen / Endfield</p>
			<h1 class="ex-bar-title">界面还原样张</h1>
		</div>
		<p class="ex-field">6 种界面 · 组件化</p>
	</header>

	<section class="block">
		<h2 class="ex-group-head"><span>01 加载指示</span><span class="ex-field">Screenshot 01</span></h2>
		<div class="stage"><Loader label="载入中" /></div>
	</section>

	<section class="block">
		<h2 class="ex-group-head"><span>02 确认对话框</span><span class="ex-field">Screenshot 02</span></h2>
		<div class="row">
			<button type="button" class="ex-btn go" onclick={() => (confirmOpen = true)}>打开确认框</button>
			{#if lastChoice}<span class="ex-field">上次选择：{lastChoice}</span>{/if}
		</div>
		<p class="hint">红色＝不可逆/危险动作，黄色＝稳妥主操作（与规则一致：红只给删除类）。</p>
	</section>

	<section class="block">
		<h2 class="ex-group-head"><span>03 等阶晋升看板</span><span class="ex-field">Screenshot 05</span></h2>
		<LevelBoard level={3} cur={80} max={720} rewardFrom={130} rewardTo={135} />
	</section>

	<section class="block">
		<h2 class="ex-group-head"><span>04 采购中心</span><span class="ex-field">Screenshot 06</span></h2>
		<div class="row">
			<a class="ex-btn go" href="/store">进入采购中心 <span class="sub">Store</span></a>
			<span class="ex-field">已在 /store 落地为真实页面</span>
		</div>
	</section>

	<section class="block">
		<h2 class="ex-group-head"><span>05 编号分节正文</span><span class="ex-field">Screenshot 04</span></h2>
		<div class="prose ex-sections demo-prose">
			<h2>关于「侵蚀」现象</h2>
			<p>黄块编号 + 分节细线：给长文一个可以数的骨架。文章页与自定义页面详情已启用。</p>
			<h2>关于「锚点」</h2>
			<p>每一节都是真实字段的一行，不做装饰性渐变与阴影。</p>
			<h3>次级标题</h3>
			<p>h2 走编号，h3 走左侧 trace 细条。</p>
		</div>
	</section>
</Container>

<ConfirmDialog
	open={confirmOpen}
	flag="设备性能不足"
	title="是否确认将画面质量调整为当前设置？"
	message="当前设置高于设备推荐设置，可能导致游戏卡顿、设备过热、耗电增加等问题。"
	dangerLabel="强制切换"
	safeLabel="保持原设置"
	onDanger={() => { lastChoice = "强制切换"; confirmOpen = false; }}
	onSafe={() => { lastChoice = "保持原设置"; confirmOpen = false; }}
	onClose={() => (confirmOpen = false)}
/>

<style>
	.block {
		margin: 2.2rem 0;
	}
	.stage {
		display: grid;
		place-items: center;
		padding: 2.4rem 0;
		background: var(--ex-panel);
		border: 1px solid var(--ex-rule);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1rem;
	}
	.hint {
		margin: 0.7rem 0 0;
		font-size: 0.78rem;
		color: var(--ex-ink-2);
	}
	.demo-prose {
		border: 1px solid var(--ex-rule);
		padding: 1.4rem 1.6rem;
		background: var(--ex-panel);
	}
	.demo-prose :is(h2, h3) {
		border-top: 0;
	}
</style>
