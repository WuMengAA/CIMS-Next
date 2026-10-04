<script lang="ts">
	import RhineArchive from "$lib/components/rhine/rhine-archive.svelte";
	import { buildClassArchiveContent, type ClassProfile, classKey } from "$lib/rhine/class-archive";

	// ── 班级档案定义（扩展字段：年级/班号/班主任/口号/班徽/人数/特色/建班年/主题色/简介/标签）──
	// 草稿示例数据 —— 真实班级风貌可由集控面板（CIMS）同步后在此展示。
	const classes: ClassProfile[] = [
		{ grade: "高一", no: "1", teacher: "张老师", slogan: "自律者自由", emblem: "🌿", members: 52, subject: "理科实验", founded: "2024", accent: "#cc785c", intro: "以自主学习为核心的研究型班级，常态化开展课题研讨与跨班共读。", tags: ["理科", "寄宿"] },
		{ grade: "高一", no: "2", teacher: "李老师", slogan: "天道酬勤", emblem: "🜂", members: 50, subject: "人文综合", founded: "2024", accent: "#0ea5e9", intro: "人文底色浓厚的班级，公众号编辑部与校园广播站主力来源。", tags: ["人文"] },
		{ grade: "高二", no: "1", teacher: "王老师", slogan: "厚积薄发", emblem: "📐", members: 49, subject: "数学竞赛", founded: "2023", accent: "#10b981", intro: "数学竞赛传统班，近年多人进入省级赛区一等奖名单。", tags: ["理科", "竞赛"] },
		{ grade: "高二", no: "3", teacher: "赵老师", slogan: "聚是一团火", emblem: "🎻", members: 48, subject: "艺术特长", founded: "2023", accent: "#f59e0b", intro: "艺术与体育并重的活力班级，校庆演出与球类联赛常驻冠军。", tags: ["艺术", "体育"] },
		{ grade: "高三", no: "1", teacher: "陈老师", slogan: "静水流深", emblem: "🗿", members: 51, subject: "综合强化", founded: "2022", accent: "#f43f5e", intro: "冲刺学年核心班，自习纪律与答疑机制成熟，目标导向明确。", tags: ["理科"] },
		{ grade: "高三", no: "2", teacher: "刘老师", slogan: "志存高远", emblem: "🚀", members: 47, subject: "国际方向", founded: "2022", accent: "#6366f1", intro: "面向海外升学的方向班，英语辩论与科研项目产出稳定。", tags: ["国际", "人文"] }
	];

	// 视觉预设（扩展样式）：纸面 / 墨色 / 强调色 / 线框 / 次要文字 / 墙底色 + 三维明暗
	const presets = [
		{ id: "archive", name: "档案墨", dark: false, paper: "#eae5e1", ink: "#080a08", accent: "#9b7247", line: "#aaa59a", muted: "#77756d", strong: "#d8d2cb", field: "#e7e3d9" },
		{ id: "neon", name: "校园霓虹", dark: true, paper: "#0e1118", ink: "#eaf6f4", accent: "#57e0c8", line: "#2a3340", muted: "#8aa0a8", strong: "#33414f", field: "#161e22" },
		{ id: "fresh", name: "清新", dark: false, paper: "#f1f7f3", ink: "#14342a", accent: "#3f9d6d", line: "#bcd8c8", muted: "#5f7d6e", strong: "#cfe6da", field: "#e8f0ea" },
		{ id: "amber", name: "暖阳", dark: false, paper: "#fbf3e7", ink: "#3a2a18", accent: "#d08a3a", line: "#e3cfa6", muted: "#8a6f47", strong: "#ecd9b6", field: "#f6ecdc" }
	];
	let presetId = $state("archive");
	const preset = $derived(presets.find((p) => p.id === presetId) ?? presets[0]);

	let view = $state<"archive" | "list">("archive");
	let selectedKey = $state<string | null>(null);

	const archive = $derived(buildClassArchiveContent(classes));
	const archiveVars = $derived(
		`--rhine-paper:${preset.paper};--rhine-ink:${preset.ink};--rhine-accent:${preset.accent};--rhine-line:${preset.line};--rhine-muted:${preset.muted};--rhine-line-strong:${preset.strong};--rhine-field:${preset.field}`
	);

	function handleOpen(href: string) {
		// 在三维墙中「读取」班级 → 切到二维档案列表并定位
		selectedKey = href.replace("/campus/classes/", "");
		view = "list";
	}
</script>

<svelte:head>
	<title>班级档案库 · 星集控</title>
	<meta name="description" content="校园班级档案 —— 以三维档案墙呈现各年级班级风貌。" />
</svelte:head>

<div class="rhine-fullscreen" style={archiveVars}>
	{#if view === "archive"}
		<RhineArchive
			archiveContent={archive}
			labels={{ db: "CAMPUS CLASS ARCHIVE / 班级档案库", hint: "← → 切换年级 · ↑ ↓ 换班级 · Enter 读取" }}
			exitHref="/campus/school"
			forceTheme={preset.dark}
			onOpen={handleOpen}
		/>
	{:else}
		<!-- 二维档案列表（扩展定义 / 详细字段） -->
		<div class="ca-list" style={archiveVars}>
			<header class="ca-list-head">
				<div>
					<p class="ca-list-kicker">CAMPUS CLASS ARCHIVE</p>
					<h1 class="ca-list-title">班级档案 · 全部 {classes.length} 个班</h1>
				</div>
				<button class="ca-back" onclick={() => (view = "archive")}>← 返回三维档案</button>
			</header>

			<section class="ca-grid">
				{#each classes as c (classKey(c))}
					{@const sel = selectedKey === classKey(c)}
					<article class="ca-card" class:selected={sel} style={`--ca-accent:${c.accent ?? preset.accent}`}>
						<div class="ca-card-top">
							<span class="ca-emblem">{c.emblem ?? "◆"}</span>
							<div>
								<div class="ca-card-title">{c.grade}（{c.no}）班</div>
								<div class="ca-card-teacher">班主任 · {c.teacher}</div>
							</div>
						</div>
						<div class="ca-slogan">「{c.slogan}」</div>
						{#if c.intro}<p class="ca-intro">{c.intro}</p>{/if}
						<dl class="ca-meta">
							{#if c.members != null}<div><dt>在册</dt><dd>{c.members} 人</dd></div>{/if}
							{#if c.subject}<div><dt>特色</dt><dd>{c.subject}</dd></div>{/if}
							{#if c.founded}<div><dt>建班</dt><dd>{c.founded}</dd></div>{/if}
						</dl>
						{#if c.tags?.length}
							<div class="ca-tags">
								{#each c.tags as t}<span class="ca-tag">{t}</span>{/each}
							</div>
						{/if}
					</article>
				{/each}
			</section>
		</div>
	{/if}

	<!-- 顶部控件：视觉预设切换 + 视图切换 -->
	<div class="ca-controls">
		<div class="ca-presets" role="group" aria-label="视觉预设">
			{#each presets as p}
				<button
					type="button"
					class="ca-preset"
					class:active={p.id === presetId}
					style={`--p-paper:${p.paper};--p-accent:${p.accent};--p-ink:${p.ink}`}
					onclick={() => (presetId = p.id)}
				>{p.name}</button>
			{/each}
		</div>
		<button type="button" class="ca-view" onclick={() => (view = view === "archive" ? "list" : "archive")}>
			{view === "archive" ? "列表视图" : "三维档案"}
		</button>
	</div>
</div>

<style>
	.rhine-fullscreen {
		position: fixed;
		inset: 0;
		z-index: 40;
		background: var(--rhine-paper, #eae5e1);
	}

	/* 让 Rhinelab 三维墙撑满全屏；并把组件自带 HUD 顶栏下移，给页面预设条让位 */
	.rhine-fullscreen :global(.rhine-hall) {
		height: 100%;
		border: none;
	}
	.rhine-fullscreen :global(.rhine-hud-title) {
		top: 56px;
	}

	/* ── 顶部控件 ── */
	.ca-controls {
		position: absolute;
		top: 10px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 60;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px;
		background: color-mix(in srgb, var(--rhine-paper, #f2efe9) 70%, transparent);
		border: 1px solid var(--rhine-line, #aaa59a);
		border-radius: 999px;
		backdrop-filter: blur(10px);
		pointer-events: auto;
	}
	.ca-presets {
		display: flex;
		gap: 4px;
	}
	.ca-preset {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 11px;
		font-size: 12px;
		color: var(--rhine-muted, #77756d);
		background: transparent;
		border: 1px solid transparent;
		border-radius: 999px;
		cursor: pointer;
		transition: all 0.18s ease;
	}
	.ca-preset::before {
		content: "";
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--p-accent);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--p-ink) 30%, transparent);
	}
	.ca-preset:hover {
		color: var(--rhine-ink, #080a08);
		border-color: var(--rhine-line, #aaa59a);
	}
	.ca-preset.active {
		color: var(--rhine-ink, #080a08);
		background: color-mix(in srgb, var(--rhine-accent, #9b7247) 16%, transparent);
		border-color: var(--rhine-accent, #9b7247);
	}
	.ca-view {
		padding: 6px 14px;
		font-size: 12px;
		letter-spacing: 0.04em;
		color: var(--rhine-accent, #9b7247);
		background: transparent;
		border: 1px solid var(--rhine-accent, #9b7247);
		border-radius: 999px;
		cursor: pointer;
		transition: all 0.18s ease;
	}
	.ca-view:hover {
		background: var(--rhine-accent, #9b7247);
		color: var(--rhine-paper, #f2efe9);
	}

	/* ── 二维列表视图 ── */
	.ca-list {
		position: absolute;
		inset: 0;
		overflow: auto;
		padding: 28px clamp(16px, 5vw, 64px) 96px;
	}
	.ca-list-head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 22px;
	}
	.ca-list-kicker {
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 11px;
		letter-spacing: 0.16em;
		color: var(--rhine-accent, #9b7247);
	}
	.ca-list-title {
		font-size: clamp(20px, 3vw, 30px);
		font-weight: 700;
		color: var(--rhine-ink, #080a08);
	}
	.ca-back {
		flex-shrink: 0;
		padding: 8px 14px;
		font-size: 13px;
		color: var(--rhine-ink, #080a08);
		background: transparent;
		border: 1px solid var(--rhine-line, #aaa59a);
		border-radius: 999px;
		cursor: pointer;
		transition: all 0.18s ease;
	}
	.ca-back:hover {
		border-color: var(--rhine-accent, #9b7247);
		color: var(--rhine-accent, #9b7247);
	}
	.ca-grid {
		display: grid;
		gap: 16px;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
	}
	.ca-card {
		position: relative;
		padding: 18px;
		background: color-mix(in srgb, var(--rhine-paper, #f2efe9) 92%, transparent);
		border: 1px solid var(--rhine-line, #aaa59a);
		border-radius: 14px;
		box-shadow: 0 8px 22px rgba(0, 0, 0, 0.08);
		transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
	}
	.ca-card.selected {
		border-color: var(--ca-accent);
		box-shadow: 0 10px 30px color-mix(in srgb, var(--ca-accent) 30%, transparent);
		transform: translateY(-2px);
	}
	.ca-card-top {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.ca-emblem {
		flex-shrink: 0;
		width: 42px;
		height: 42px;
		display: grid;
		place-items: center;
		font-size: 22px;
		border-radius: 12px;
		background: color-mix(in srgb, var(--ca-accent) 18%, transparent);
		border: 1px solid color-mix(in srgb, var(--ca-accent) 40%, transparent);
	}
	.ca-card-title {
		font-size: 16px;
		font-weight: 700;
		color: var(--rhine-ink, #080a08);
	}
	.ca-card-teacher {
		font-size: 12px;
		color: var(--rhine-muted, #77756d);
		margin-top: 2px;
	}
	.ca-slogan {
		margin-top: 12px;
		font-size: 14px;
		font-weight: 600;
		color: var(--ca-accent);
	}
	.ca-intro {
		margin-top: 8px;
		font-size: 13px;
		line-height: 1.6;
		color: var(--rhine-muted, #77756d);
	}
	.ca-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 14px;
		margin: 12px 0 0;
	}
	.ca-meta div {
		display: flex;
		flex-direction: column;
	}
	.ca-meta dt {
		font-size: 10px;
		letter-spacing: 0.08em;
		color: var(--rhine-muted, #77756d);
	}
	.ca-meta dd {
		font-size: 13px;
		font-weight: 600;
		color: var(--rhine-ink, #080a08);
	}
	.ca-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 12px;
	}
	.ca-tag {
		padding: 2px 9px;
		font-size: 11px;
		color: var(--ca-accent);
		background: color-mix(in srgb, var(--ca-accent) 12%, transparent);
		border-radius: 999px;
	}
</style>
