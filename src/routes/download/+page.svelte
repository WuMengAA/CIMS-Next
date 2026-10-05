<script lang="ts">
	/**
	 * 下载中心。页面本身不存版本号 —— 数据全部来自服务端（服务端再去云端拿），
	 * 所以这里只负责"画"和"复制 sha256"这两件事。
	 */
	import Container from "$lib/components/container.svelte";
	import PageHeader from "$lib/components/page-header.svelte";
	// ⚠️ 必须挂 use:reveal：.reveal 在 html.js 下初态是 opacity:0/blur(10px)，
	// 只有该 action 进视口时补上 .revealed 才会显形。只写 class="reveal" 会**永久隐形**。
	import { reveal } from "$lib/actions/reveal.js";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import {
		Download,
		Copy,
		Check,
		Server,
		Monitor,
		ShieldCheck,
		ExternalLink,
		TriangleAlert
	} from "@lucide/svelte";

	let { data }: { data: import("./$types").PageData } = $props();

	// 复制 sha256：让老师/管理员能自己校验包没被改过（下载页给了值就必须可复制，否则等于没给）
	let copiedId = $state("");

	async function copyText(text: string, id: string) {
		try {
			await navigator.clipboard.writeText(text);
			copiedId = id;
			setTimeout(() => {
				if (copiedId === id) copiedId = "";
			}, 2000);
		} catch {
			copiedId = "";
		}
	}
</script>

<svelte:head>
	<title>下载中心 | Stelarith 星集控</title>
	<meta
		name="description"
		content="星集控教室机被控端与管理端（老师机）的下载页：版本、体积、sha256 校验值与装机步骤。"
	/>
</svelte:head>

<Container>
	<PageHeader
		title="下载中心"
		eyebrow="星集控 · 装机入口"
		description="教室机装被控端，老师机装管理端。页面上的版本号与 sha256 直接取自云端发布清单，发版后自动跟着变 —— 不会出现「官网写的版本和实际能下到的不是同一个」。"
	/>

	<div
		use:reveal
		class="reveal flex items-start gap-3 rounded-lg border border-border/60 bg-muted/40 p-4 text-sm text-muted-foreground"
		style="--reveal-delay:0"
	>
		<ShieldCheck class="mt-0.5 size-4 shrink-0 text-emerald-500" />
		<p>
			每个包都给出 <span class="font-medium text-foreground">sha256</span>：下载后可自行校验，确认包没被中间环节改过。
			被控端升级时会再校验一次（校验不过就拒绝安装）。
		</p>
	</div>

	{#each data.products as p, i (p.id)}
		<section
			use:reveal
			class="reveal flex flex-col gap-4 rounded-xl border border-border/60 bg-card p-6"
			style="--reveal-delay:{i + 1}"
		>
			<div class="flex flex-wrap items-start justify-between gap-4">
				<div class="flex items-start gap-3">
					{#if p.id === "agent"}
						<Server class="mt-1 size-5 text-primary" />
					{:else}
						<Monitor class="mt-1 size-5 text-primary" />
					{/if}
					<div class="flex flex-col gap-1">
						<div class="flex flex-wrap items-center gap-2">
							<h2 class="font-heading text-xl font-semibold">{p.name}</h2>
							{#if p.published}
								<Badge variant="secondary">v{p.version}</Badge>
							{:else}
								<Badge variant="outline">未发布</Badge>
							{/if}
						</div>
						<p class="text-sm text-muted-foreground">适用：{p.who}</p>
					</div>
				</div>

				<div class="flex flex-col items-end gap-2">
					{#if p.published}
						<Button href={p.url} target="_blank" rel="noopener">
							<Download class="size-4" />
							下载（{p.sizeText}）
						</Button>
					{:else}
						<Button disabled variant="secondary">
							<Download class="size-4" />
							暂不可下载
						</Button>
					{/if}
					{#if p.published}
						<code class="text-xs text-muted-foreground">{p.url.split("/").pop()}</code>
					{/if}
				</div>
			</div>

			<p class="text-sm leading-relaxed">{p.summary}</p>

			{#if p.published}
				<div class="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-muted/30 p-3">
					<span class="text-xs font-medium text-muted-foreground">sha256</span>
					<code class="max-w-full overflow-x-auto text-xs">{p.sha256}</code>
					<button
						type="button"
						class="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-xs hover:bg-muted"
						onclick={() => copyText(p.sha256, p.id)}
					>
						{#if copiedId === p.id}
							<Check class="size-3 text-emerald-500" /> 已复制
						{:else}
							<Copy class="size-3" /> 复制
						{/if}
					</button>
				</div>

				{#if p.notes}
					<p class="text-sm text-muted-foreground">{p.notes}</p>
				{/if}
			{:else}
				<div class="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
					<TriangleAlert class="mt-0.5 size-4 shrink-0 text-amber-500" />
					<div>
						<p class="font-medium">暂时取不到这个产品的版本信息。</p>
						<p class="text-muted-foreground">
							可能是云端还没发布过，或云端暂时不可达。{p.error ? `（${p.error}）` : ""}
							这里不会显示旧版本号来充数 —— 请稍后刷新，或直接问管理员要安装包。
						</p>
					</div>
				</div>
			{/if}

			<div class="flex flex-col gap-2">
				<p class="text-sm font-medium">怎么装</p>
				<ol class="flex list-decimal flex-col gap-1 pl-5 text-sm text-muted-foreground">
					{#each p.steps as s}
						<li>{s}</li>
					{/each}
				</ol>
			</div>
		</section>
	{/each}

	<section
		use:reveal
		class="reveal flex flex-col gap-3 rounded-xl border border-border/60 bg-muted/30 p-6 text-sm"
		style="--reveal-delay:{data.products.length + 1}"
	>
		<p class="font-medium">装完之后的配套服务</p>
		<ul class="flex flex-col gap-1 text-muted-foreground">
			<li>· 设备在线状态、远程画面、发通知、推文件：登录集控控制台操作（需管理端令牌）。</li>
			<li>· 批量装机：控制台里按机器生成「一机一密」装机 bat，教室机双击即可，无需手改配置。</li>
			<li>· 版本升级：被控端托盘 →「设置与信息…」能看到当前版本、有没有新版，并可一键升级。</li>
			<li>
				· 部署与排障文档见
				<a class="underline hover:text-foreground" href="/docs">文档中心</a>；更新内容见
				<a class="underline hover:text-foreground" href="/changelog">更新日志</a>。
			</li>
		</ul>
		<div class="flex flex-wrap gap-2 pt-1">
			<Button variant="secondary" href="https://control.245959623.xyz" target="_blank" rel="noopener">
				打开控制台
				<ExternalLink class="size-4" />
			</Button>
			<Button variant="ghost" href="/docs">文档中心</Button>
		</div>
	</section>
</Container>
