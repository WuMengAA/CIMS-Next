<script lang="ts">
	import { page } from "$app/state";
	import StudentDoc from "$lib/components/voicehub/StudentDoc.svelte";
	import StaffDoc from "$lib/components/voicehub/StaffDoc.svelte";
	import OnepagerDoc from "$lib/components/voicehub/OnepagerDoc.svelte";
	import { BookOpen, FileText, LayoutPanelTop } from "@lucide/svelte";

	const tabs = [
		{ id: "student", label: "同学须知", icon: BookOpen },
		{ id: "staff", label: "成员须知", icon: FileText },
		{ id: "onepager", label: "一页纸", icon: LayoutPanelTop }
	];

	let active = $state("student");

	// FAQ 结构化数据：放在父页 DOM（不在 iframe 内），搜索引擎可直读，用于富媒体结果。
	// 客服邮箱与文档一致。
	const faqLd = {
		"@context": "https://schema.org",
		"@type": "FAQPage",
		"mainEntity": [
			{ "@type": "Question", "name": "怎么点歌？", "acceptedAnswer": { "@type": "Answer", "text": "打开点歌入口并登录账号，搜索或输入想点的歌，写清歌名、歌手、想说的话、点给谁四项，提交后等待审核。" } },
			{ "@type": "Question", "name": "审核要多久？", "acceptedAnswer": { "@type": "Answer", "text": "在审核时限内完成审核，可在「我的点歌」查看状态：待审核 → 已通过 → 已播放。" } },
			{ "@type": "Question", "name": "哪些歌不能点？", "acceptedAnswer": { "@type": "Answer", "text": "违规、低俗、侵权、攻击性歌曲；未标明歌手或歌名的无名曲；含个人隐私信息的点歌。" } },
			{ "@type": "Question", "name": "被驳回了怎么办？", "acceptedAnswer": { "@type": "Answer", "text": "查看驳回原因，补全歌名或歌手、或替换音源后重新提交；信息不实无法核实的将不予通过。" } },
			{ "@type": "Question", "name": "有问题找谁？", "acceptedAnswer": { "@type": "Answer", "text": "客服与投诉：2498517208@qq.com。" } }
		]
	};

	// 哈希联动：从 /voicehub 主页面或文档内链接跳过来时，自动切到对应标签页
	$effect(() => {
		const h = page.url.hash.replace("#", "");
		if (h && tabs.some((t) => t.id === h)) active = h;
	});

	function select(id: string) {
		active = id;
		history.replaceState(null, "", `#${id}`);
	}
</script>

<svelte:head>
	<title>点歌帮助 | Stelarith</title>
	<meta name="description" content="校园点歌使用帮助：同学点歌须知、广播站成员操作与维护须知、一页纸合并版。覆盖在哪点歌、审核标准、排单播前检查与故障处理。" />
	<meta name="robots" content="index, follow" />
	<meta property="og:type" content="article" />
	<meta property="og:locale" content="zh_CN" />
	<meta property="og:title" content="校园点歌 · 使用帮助 | Stelarith" />
	<meta property="og:description" content="同学点歌须知 + 广播站成员操作维护须知 + 一页纸合并版。点歌步骤、审核标准、排单播前检查、故障应急全覆盖。" />
	<meta property="og:site_name" content="Stelarith" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="校园点歌 · 使用帮助 | Stelarith" />
	<meta name="twitter:description" content="同学点歌须知 + 广播站成员操作维护须知 + 一页纸合并版。" />
	{@html `<script type="application/ld+json">${JSON.stringify(faqLd)}<\/script>`}
</svelte:head>

<div class="ef-shell ef-shell--wide flex flex-col gap-5 py-10">
	<header class="flex flex-col gap-2">
		<h1 class="flex items-center gap-2 font-heading text-3xl font-semibold tracking-tight">
			校园点歌 · 使用帮助
		</h1>
		<p class="text-sm text-muted-foreground">
			分别写给点歌同学和广播站成员 · 三份文档可切换，底部互链
		</p>
	</header>

	<div class="flex flex-wrap gap-2 border-b border-border pb-3">
		{#each tabs as t (t.id)}
			{@const Icon = t.icon}
			<button
				type="button"
				onclick={() => select(t.id)}
				aria-pressed={active === t.id}
				class="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors {active ===
				t.id
					? 'bg-primary text-primary-foreground'
					: 'bg-muted/50 text-muted-foreground hover:bg-muted'}"
			>
				<Icon class="size-4" />
				{t.label}
			</button>
		{/each}
	</div>

	<!-- 三份正文全部常驻 DOM（SSR 可抓取），仅用 display:none 切换可见标签，兼顾 SEO 与标签交互 -->
	<div class="doc-pane" class:hidden={active !== "student"}><StudentDoc /></div>
	<div class="doc-pane" class:hidden={active !== "staff"}><StaffDoc /></div>
	<div class="doc-pane" class:hidden={active !== "onepager"}><OnepagerDoc /></div>
</div>

<style>
	.doc-pane.hidden { display: none; }
</style>
