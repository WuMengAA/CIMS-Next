<script lang="ts">
	import Container from "$lib/components/container.svelte";
	import PageHeader from "$lib/components/page-header.svelte";
</script>

<svelte:head>
	<title>学校一览 · 星集控</title>
	<meta name="description" content="学校一览（草稿）——校园总览、办学信息与联系方式。" />
</svelte:head>

<Container>
	<PageHeader title="学校一览" description="校园总览 · 草稿示例内容" />

	<div class="reveal rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300" style="--reveal-delay:1">
		⚠️ 本页为草稿示例内容，校名、数据、联系方式均为占位，待管理员在后台「页面 / 设置」中补充替换。
	</div>

	<section class="reveal grid gap-6 md:grid-cols-[1.4fr_1fr]" style="--reveal-delay:2">
		<div class="rounded-xl border bg-card p-6">
			<h2 class="font-heading text-xl font-semibold">关于学校</h2>
			<p class="mt-3 text-sm leading-7 text-muted-foreground">
				这里是学校简介的占位段落。可补充学校的办学历史、校园文化、特色课程与所获荣誉等内容。
				建议控制在 2–3 段，配合下方「办学理念」卡片，让读者一眼抓住学校气质。
			</p>
			<dl class="mt-5 grid grid-cols-2 gap-4 text-sm">
				<div><dt class="text-muted-foreground">校训</dt><dd class="mt-1 font-medium">待补充</dd></div>
				<div><dt class="text-muted-foreground">创办年份</dt><dd class="mt-1 font-medium">待补充</dd></div>
				<div><dt class="text-muted-foreground">办学层次</dt><dd class="mt-1 font-medium">待补充</dd></div>
				<div><dt class="text-muted-foreground">所属地区</dt><dd class="mt-1 font-medium">待补充</dd></div>
			</dl>
		</div>
		<div class="rounded-xl border bg-card p-6">
			<h2 class="font-heading text-xl font-semibold">办学理念</h2>
			<ul class="mt-3 space-y-3 text-sm text-muted-foreground">
				<li class="flex gap-2"><span class="text-primary">·</span><span>以学习者为中心，关注每一个孩子的成长节奏。</span></li>
				<li class="flex gap-2"><span class="text-primary">·</span><span>用技术与标准换时间，把老师从重复劳动中解放出来。</span></li>
				<li class="flex gap-2"><span class="text-primary">·</span><span>守护珍爱之物 —— 人、设备与校园秩序。</span></li>
			</ul>
		</div>
	</section>

	<section class="reveal grid grid-cols-2 gap-4 sm:grid-cols-4" style="--reveal-delay:3">
		{#each [["班级数", "—"], ["在校学生", "—"], ["专任教师", "—"], ["功能教室", "—"]] as [k, v]}
			<div class="rounded-lg border bg-card p-4 text-center">
				<div class="font-heading text-2xl font-semibold">{v}</div>
				<div class="mt-1 text-xs text-muted-foreground">{k}</div>
			</div>
		{/each}
	</section>

	<section class="reveal rounded-xl border bg-card p-6" style="--reveal-delay:4">
		<h2 class="font-heading text-xl font-semibold">联系我们</h2>
		<dl class="mt-3 grid gap-3 text-sm sm:grid-cols-2">
			<div><dt class="text-muted-foreground">学校地址</dt><dd class="mt-1">待补充</dd></div>
			<div><dt class="text-muted-foreground">办公电话</dt><dd class="mt-1">待补充</dd></div>
			<div><dt class="text-muted-foreground">招生咨询</dt><dd class="mt-1">待补充</dd></div>
			<div><dt class="text-muted-foreground">电子邮箱</dt><dd class="mt-1">待补充</dd></div>
		</dl>
	</section>
</Container>
