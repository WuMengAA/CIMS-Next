<script lang="ts">
	import Container from "$lib/components/container.svelte";
	import PageHeader from "$lib/components/page-header.svelte";

	// 草稿示例班级数据 —— 真实班级风貌可由集控面板（CIMS）同步后在此展示。
	const classes = [
		{ grade: "高一", no: "1", teacher: "张老师", slogan: "自律者自由", color: "from-violet-500/20 to-fuchsia-500/10" },
		{ grade: "高一", no: "2", teacher: "李老师", slogan: "天道酬勤", color: "from-sky-500/20 to-cyan-500/10" },
		{ grade: "高二", no: "1", teacher: "王老师", slogan: "厚积薄发", color: "from-emerald-500/20 to-teal-500/10" },
		{ grade: "高二", no: "3", teacher: "赵老师", slogan: "聚是一团火", color: "from-amber-500/20 to-orange-500/10" },
		{ grade: "高三", no: "1", teacher: "陈老师", slogan: "静水流深", color: "from-rose-500/20 to-pink-500/10" },
		{ grade: "高三", no: "2", teacher: "刘老师", slogan: "志存高远", color: "from-indigo-500/20 to-blue-500/10" }
	];
</script>

<svelte:head>
	<title>班级风貌 · 星集控</title>
	<meta name="description" content="班级风貌（草稿）——各班级风采展示。" />
</svelte:head>

<Container>
	<PageHeader title="班级风貌" description="各班级风采展示 · 草稿示例内容" />

	<div class="reveal rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300" style="--reveal-delay:1">
		⚠️ 本页为草稿示例内容，班级与班主任信息均为占位。真实数据可在集控面板绑定班级后同步展示。
	</div>

	<section class="reveal grid gap-4 sm:grid-cols-2 lg:grid-cols-3" style="--reveal-delay:2">
		{#each classes as c}
			<article class="group overflow-hidden rounded-xl border bg-card transition hover:shadow-md">
				<div class="bg-gradient-to-br {c.color} px-5 py-4">
					<div class="font-heading text-lg font-semibold">{c.grade}（{c.no}）班</div>
					<div class="mt-1 text-xs text-muted-foreground">班主任 · {c.teacher}</div>
				</div>
				<div class="px-5 py-4">
					<div class="text-sm text-muted-foreground">班级口号</div>
					<div class="mt-1 font-medium">「{c.slogan}」</div>
				</div>
			</article>
		{/each}
	</section>
</Container>
