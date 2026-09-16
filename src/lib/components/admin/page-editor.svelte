<script lang="ts">
	/**
	 * 独立页面编辑器 —— 与 content-editor（文章编辑器）刻意分开。
	 *
	 * 为什么要独立而不是给文章编辑器加几个开关：
	 * 文章的核心是「内容 + 元数据」，页面的核心是「内容 + 版式设计」。
	 * 后者需要版心宽窄、页头形态、主题色、侧栏目录、响应式预览这些
	 * 视觉维度，塞进文章编辑器会让两边都变复杂。分开后各自演进。
	 *
	 * 三段式布局：左 = 模板与结构，中 = 正文，右 = 版式与发布。
	 * 窄屏下右侧面板折叠为标签页，避免三列挤压。
	 */
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import * as Select from "$lib/components/ui/select/index.js";
	import {
		PAGE_TEMPLATES, LAYOUT_PRESETS, getTemplate,
		type PageTemplate
	} from "$lib/page-templates.js";
	import {
		Save, ArrowLeft, Bold, Italic, Strikethrough, Heading2, Quote, List, ListOrdered,
		ListTodo, Table, Minus, Code, SquareCode, Link as LinkIcon, Image as ImageIcon,
		Monitor, Tablet, Smartphone, Palette, Type, LayoutTemplate, Eye, LayoutPanelLeft,
		FileText, User, Rocket, BookOpen, Megaphone, ChevronDown, Sparkles, Columns2, Maximize2, Archive
	} from "@lucide/svelte";
	import { toast } from "svelte-sonner";
	import { page } from "$app/state";
	import IconPicker from "$lib/components/icon-picker.svelte";

	let {
		slug = "new",
		backUrl = "/admin/pages"
	}: { slug?: string; backUrl?: string } = $props();

	// ---- 内容 ----
	let title = $state("");
	let body = $state("");
	let excerpt = $state("");
	let category = $state("");
	let tags = $state("");
	let status = $state<"published" | "draft">("published");
	let cover = $state("");
	let navTitle = $state("");
	let icon = $state("");

	// ---- 版式设计 ----
	let layout = $state<"narrow" | "standard" | "wide" | "full">("standard");
	let hero = $state<"none" | "plain" | "banner">("plain");
	let aside = $state(false);
	let toc = $state(false);
	let hideTitle = $state(false);
	let noindex = $state(false);
	let accent = $state("");

	// ---- 状态 ----
	let saving = $state(false);
	let saved = $state(false);
	let loaded = $state(false);
	let savedSlug = $state("");
	let previewHtml = $state("");
	let previewTimer: ReturnType<typeof setTimeout> | undefined;

	// 三栏在窄屏下的显示控制：'edit' 正文，'design' 设计面板
	let narrowPane = $state<"edit" | "design">("edit");
	// 预览设备尺寸
	let device = $state<"desktop" | "tablet" | "mobile">("desktop");
	// 模板选择器展开
	let tplOpen = $state(true);

	// ---- 站内文件引用（媒体库）----
	// mediaMode：插入目标，"body" 插正文（Markdown 图片语法），"cover" 设为封面图地址
	let mediaMode = $state<"body" | "cover">("body");
	let mediaShow = $state(false);
	let mediaList = $state<{ url: string; filename: string }[]>([]);
	let mediaLoading = $state(false);
	let uploadingImg = $state(false);
	let fileInput: HTMLInputElement | undefined = $state(undefined);

	async function openMedia(mode: "body" | "cover") {
		mediaMode = mode;
		mediaShow = true;
		await loadMedia();
	}
	async function loadMedia() {
		mediaLoading = true;
		try {
			const res = await fetch("/api/media");
			if (res.ok) mediaList = await res.json();
		} catch (e) { console.error(e); }
		mediaLoading = false;
	}
	async function onMediaFile(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		input.value = "";
		if (!file) return;
		uploadingImg = true;
		try {
			const form = new FormData();
			form.append("file", file);
			const res = await fetch("/api/media", { method: "POST", body: form });
			const data = await res.json();
			if (res.ok && data.url) {
				if (mediaMode === "cover") {
					cover = data.url;
					toast.success("图片已上传并设为封面");
				} else {
					const alt = file.name.replace(/\.[^.]+$/, "");
					insertAtCursor("\n\n![" + alt + "](" + data.url + ")\n\n", "", "", false);
					toast.success("图片已上传并插入正文");
				}
				mediaShow = false;
				loadMedia();
			} else {
				toast.error(data.error || "上传失败");
			}
		} catch (err) { toast.error("上传失败"); }
		uploadingImg = false;
	}
	function pickMedia(url: string, filename: string) {
		if (mediaMode === "cover") {
			cover = url;
			toast.success("已设为封面");
		} else {
			const alt = (filename || url.split("/").pop() || "图片").replace(/\.[^.]+$/, "");
			insertAtCursor("\n\n![" + alt + "](" + url + ")\n\n", "", "", false);
			toast.success("已插入图片");
		}
		mediaShow = false;
	}

	const apiPath = "/api/pages";

	/** 模板图标映射：模板文件不引图标库，在这里做一次翻译。 */
	const TPL_ICON: Record<string, any> = {
		file: FileText, user: User, rocket: Rocket, palette: Palette,
		book: BookOpen, link: LinkIcon, megaphone: Megaphone
	};

	const layoutPreset = $derived(LAYOUT_PRESETS.find((p) => p.value === layout) ?? LAYOUT_PRESETS[1]);

	// ---- 载入 ----
	$effect(() => {
		if (slug !== "new" && !loaded) load();
	});
	// 正文变化 → 防抖重渲预览
	$effect(() => {
		const _ = body;
		if (previewTimer) clearTimeout(previewTimer);
		previewTimer = setTimeout(renderPreview, 350);
		return () => { if (previewTimer) clearTimeout(previewTimer); };
	});

	async function load() {
		try {
			const res = await fetch(apiPath + "?action=get&slug=" + encodeURIComponent(slug));
			if (!res.ok) return;
			const it = await res.json();
			title = it.title || "";
			body = it.body || "";
			excerpt = it.excerpt || "";
			category = it.category || "";
			tags = (it.tags || []).join(", ");
			status = it.status || "published";
			cover = it.cover || "";
			navTitle = it.navTitle || "";
			icon = it.icon || "";
			layout = it.layout || "standard";
			hero = it.hero || "plain";
			aside = !!it.aside;
			toc = !!it.toc;
			hideTitle = !!it.hideTitle;
			noindex = !!it.noindex;
			accent = it.accent || "";
			loaded = true;
		} catch (e) { console.error(e); }
	}

	async function renderPreview() {
		if (!body) { previewHtml = ""; return; }
		try {
			const res = await fetch(apiPath, {
				method: "PUT", headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ body })
			});
			previewHtml = (await res.json()).html;
		} catch (e) { console.error(e); }
	}

	/** 应用模板：只填空缺项，不覆盖用户已写的内容（避免误伤）。 */
	function applyTemplate(t: PageTemplate) {
		if (body.trim() && body.trim() !== getTemplate("blank")?.body.trim()) {
			if (!confirm("当前正文已有内容，套用模板会覆盖它。确定继续？")) return;
		}
		body = t.body;
		layout = t.layout;
		hero = t.hero;
		aside = t.aside;
		toc = t.toc;
		if (t.category && !category) category = t.category;
		tplOpen = false;
		toast.success(`已套用「${t.name}」模板`);
	}

	async function save(redirect = false) {
		if (!title.trim() || !body.trim()) {
			toast.error("标题与正文都不能为空");
			return;
		}
		saving = true; saved = false;
		try {
			const tagsArr = tags.split(",").map((t) => t.trim()).filter(Boolean);
			const payload: Record<string, unknown> = {
				title, body, status,
				// 显式传空串 = 清空该字段（store 的白名单会删除）；页面的设计字段
				// 必须"传了就生效、不传就保留"，所以这里全量传，不做省略。
				excerpt, category, cover, navTitle, accent, icon,
				tags: tagsArr,
				layout, hero,
				aside: aside ? "true" : "",
				toc: toc ? "true" : "",
				hideTitle: hideTitle ? "true" : "",
				noindex: noindex ? "true" : ""
			};
			if (slug !== "new") payload.slug = slug;
			const res = await fetch(apiPath, {
				method: "POST",
				headers: { "Content-Type": "application/json", "x-action": "save" },
				body: JSON.stringify(payload)
			});
			const result = await res.json();
			if (res.ok) {
				savedSlug = result.slug || "";
				saved = true;
				toast.success("已保存");
				localStorage.setItem("acofork_need_refresh", "1");
				setTimeout(() => { saved = false; }, 2500);
				if (redirect && result.slug) window.location.href = backUrl;
			} else {
				toast.error(result.error || "保存失败，请重试");
			}
		} catch (e) { console.error(e); toast.error("保存失败，请重试"); }
		saving = false;
	}

	// ===== 一键归档 =====
	// status 置为 archived：前台列表只展示 published，归档即隐藏，
	// 文件与版本快照保留，可在后台「归档管理」恢复。
	async function archiveItem() {
		if (slug === "new") return;
		if (!confirm("归档后该页面将从列表与前台隐藏，可在后台「归档管理」中恢复。确定归档？")) return;
		saving = true;
		try {
			const payload: Record<string, unknown> = { slug, title, body, status: "archived" };
			const res = await fetch(apiPath, {
				method: "POST",
				headers: { "Content-Type": "application/json", "x-action": "save" },
				body: JSON.stringify(payload)
			});
			if (res.ok) {
				toast.success("已归档");
				localStorage.setItem("acofork_need_refresh", "1");
				window.location.href = backUrl;
			} else {
				const r = await res.json();
				toast.error(r.error || "归档失败，请重试");
			}
		} catch (e) { console.error(e); toast.error("归档失败，请重试"); }
		saving = false;
	}

	// ---- 正文工具栏：与文章编辑器保持同一套交互，避免两处手感不一致 ----
	let bodyEl: HTMLTextAreaElement | undefined = $state(undefined);

	function insertAtCursor(before: string, after = "", placeholder = "") {
		const el = bodyEl;
		if (!el) return;
		const start = el.selectionStart ?? body.length;
		const end = el.selectionEnd ?? body.length;
		const sel = body.slice(start, end);
		const text = sel || placeholder;
		body = body.slice(0, start) + before + text + after + body.slice(end);
		const caret = start + before.length + text.length;
		queueMicrotask(() => {
			el.focus();
			el.setSelectionRange(caret, caret);
		});
	}

	const TOOLBAR = [
		{ icon: Bold, title: "加粗", run: () => insertAtCursor("**", "**", "加粗文字") },
		{ icon: Italic, title: "斜体", run: () => insertAtCursor("*", "*", "斜体文字") },
		{ icon: Strikethrough, title: "删除线", run: () => insertAtCursor("~~", "~~", "删除文字") },
		{ icon: Heading2, title: "二级标题", run: () => insertAtCursor("\n## ", "", "小标题") },
		{ icon: Quote, title: "引用", run: () => insertAtCursor("\n> ", "", "引用内容") },
		{ icon: List, title: "无序列表", run: () => insertAtCursor("\n- ", "", "列表项") },
		{ icon: ListOrdered, title: "有序列表", run: () => insertAtCursor("\n1. ", "", "列表项") },
		{ icon: ListTodo, title: "任务列表", run: () => insertAtCursor("\n- [ ] ", "", "待办") },
		{ icon: LinkIcon, title: "链接", run: () => insertAtCursor("[", "](https://)", "链接文字") },
		{ icon: ImageIcon, title: "图片", run: () => openMedia("body") },
		{ icon: SquareCode, title: "代码块", run: () => insertAtCursor("\n```\n", "\n```\n", "代码") },
		{ icon: Code, title: "行内代码", run: () => insertAtCursor("`", "`", "code") },
		{ icon: Table, title: "表格", run: () => insertAtCursor("\n| 列一 | 列二 |\n| --- | --- |\n| ", " |  |\n", "内容") },
		{ icon: Minus, title: "分割线", run: () => insertAtCursor("\n\n---\n\n") }
	];

	// 预览面板宽度：按设备档位换算真实像素比例
	const previewWidth = $derived(
		device === "mobile" ? "390px" : device === "tablet" ? "768px" : "100%"
	);
</script>

<svelte:head>
	<title>{slug === "new" ? "新建页面" : "编辑页面"} | Stelarith CMS</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="page-editor">
	<!-- ═══ 顶栏：返回 + 标题状态 + 主要动作 ═══ -->
	<header class="pe-header">
		<div class="flex min-w-0 items-center gap-3">
			<a href={backUrl} class="pe-icon-btn" title="返回页面列表">
				<ArrowLeft class="size-4" />
			</a>
			<div class="min-w-0">
				<div class="flex items-center gap-2">
					<h1 class="truncate font-heading text-base font-semibold">
						{slug === "new" ? "新建页面" : title || "未命名页面"}
					</h1>
					{#if status === "draft"}<Badge variant="outline" class="text-[10px]">草稿</Badge>{/if}
					{#if saved}<Badge variant="secondary" class="text-[10px]">已保存</Badge>{/if}
				</div>
				<p class="truncate text-xs text-muted-foreground">
					{slug === "new" ? "选择一个模板快速开始" : `/${savedSlug || slug}`}
				</p>
			</div>
		</div>
		<!-- 按键位置约定：右侧固定为「预览态切换 + 保存」，与后台其它编辑页一致 -->
		<div class="flex shrink-0 items-center gap-2">
			<div class="pe-device-group">
				{#each [{ k: "desktop", i: Monitor, t: "桌面" }, { k: "tablet", i: Tablet, t: "平板" }, { k: "mobile", i: Smartphone, t: "手机" }] as d (d.k)}
					<button
						class="pe-device-btn {device === d.k ? 'on' : ''}"
						title={d.t + "预览"}
						onclick={() => (device = d.k as any)}
					><d.i class="size-3.5" /></button>
				{/each}
			</div>
			<Button variant="outline" size="sm" onclick={() => save(false)} disabled={saving}>
				<Save class="mr-1.5 size-3.5" />{saving ? "保存中…" : "保存"}
			</Button>
			<Button size="sm" onclick={() => save(true)} disabled={saving}>保存并返回</Button>
			{#if slug !== "new"}
				<button class="pe-icon-btn" title="一键归档：从列表与前台隐藏，可在后台归档管理中恢复" onclick={archiveItem}>
					<Archive class="size-4" />
				</button>
			{/if}
		</div>
	</header>

	<!-- 窄屏标签页：三栏在小屏放不下，用两个标签切换"写"与"设计" -->
	<div class="pe-tabs">
		<button class="pe-tab {narrowPane === 'edit' ? 'on' : ''}" onclick={() => (narrowPane = "edit")}>
			<Type class="size-3.5" /> 内容
		</button>
		<button class="pe-tab {narrowPane === 'design' ? 'on' : ''}" onclick={() => (narrowPane = "design")}>
			<LayoutTemplate class="size-3.5" /> 版式与发布
		</button>
	</div>

	<div class="pe-body">
		<!-- ═══ 左栏：模板 + 结构 ═══ -->
		<aside class="pe-col pe-left" class:hide-narrow={narrowPane !== "design"}>
			<section class="pe-card">
				<button class="pe-card-head" onclick={() => (tplOpen = !tplOpen)}>
					<span class="flex items-center gap-2"><Sparkles class="size-3.5" /> 快捷模板</span>
					<ChevronDown class="size-3.5 transition-transform {tplOpen ? '' : '-rotate-90'}" />
				</button>
				{#if tplOpen}
					<div class="pe-tpl-list">
						{#each PAGE_TEMPLATES as t (t.id)}
							{@const I = TPL_ICON[t.icon] ?? FileText}
							<button class="pe-tpl" onclick={() => applyTemplate(t)} title={t.desc}>
								<I class="size-4 shrink-0 text-primary" />
								<span class="min-w-0 text-left">
									<span class="block truncate text-[13px] font-medium">{t.name}</span>
									<span class="block truncate text-[11px] text-muted-foreground">{t.desc}</span>
								</span>
							</button>
						{/each}
					</div>
				{/if}
			</section>

			<section class="pe-card">
				<div class="pe-card-head static"><span class="flex items-center gap-2"><Eye class="size-3.5" /> 实时预览</span></div>
				<div class="pe-preview-wrap">
					<div class="pe-preview" style="max-width: {previewWidth};">
						<div class="pe-preview-inner {layout === 'full' ? 'is-full' : ''}">
							{#if hero === "banner" && cover}
								<div class="pe-pv-banner" style="background-image: url('{cover}')"></div>
							{/if}
							{#if hero !== "none" && !hideTitle}
								<h2 class="pe-pv-title">{title || "页面标题"}</h2>
							{/if}
							{#if previewHtml}
								<div class="pe-pv-body prose">{@html previewHtml}</div>
							{:else}
								<p class="pe-pv-empty">正文将在这里显示…</p>
							{/if}
						</div>
					</div>
					<p class="pe-hint">预览为近似效果，最终以实际页面为准</p>
				</div>
			</section>
		</aside>

		<!-- ═══ 中栏：正文 ═══ -->
		<main class="pe-col pe-center" class:hide-narrow={narrowPane !== "edit"}>
			<div class="pe-field">
				<Input bind:value={title} placeholder="页面标题" class="pe-title-input" />
			</div>
			<div class="pe-toolbar">
				{#each TOOLBAR as t (t.title)}
					<button class="pe-tb-btn" title={t.title} onclick={t.run}>
						<t.icon class="size-3.5" />
					</button>
				{/each}
			</div>
			<textarea bind:this={bodyEl} bind:value={body} class="pe-textarea" placeholder="用 Markdown 编写页面内容…"></textarea>
		</main>

		<!-- ═══ 右栏：版式与发布 ═══ -->
		<aside class="pe-col pe-right" class:hide-narrow={narrowPane !== "design"}>
			<section class="pe-card">
				<div class="pe-card-head static"><span class="flex items-center gap-2"><LayoutPanelLeft class="size-3.5" /> 版式</span></div>
				<div class="pe-fields">
					<div class="pe-field">
						<Label class="pe-label">版心宽度</Label>
						<div class="pe-layout-grid">
							{#each LAYOUT_PRESETS as p (p.value)}
								<button class="pe-layout-opt {layout === p.value ? 'on' : ''}" onclick={() => (layout = p.value as any)} title={p.desc}>
									<span class="pe-layout-bar" data-w={p.value}></span>
									<span class="text-[11px]">{p.label}</span>
								</button>
							{/each}
						</div>
						<p class="pe-hint">{layoutPreset.desc}</p>
					</div>

					<div class="pe-field">
						<Label class="pe-label">页头样式</Label>
						<Select.Root type="single" bind:value={hero}>
							<Select.Trigger class="w-full">
								{hero === "none" ? "无页头（内容自带头图）" : hero === "banner" ? "横幅（用封面做背景）" : "朴素标题"}
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="plain" label="朴素标题" />
								<Select.Item value="banner" label="横幅（用封面做背景）" />
								<Select.Item value="none" label="无页头（内容自带头图）" />
							</Select.Content>
						</Select.Root>
					</div>

					<div class="pe-field">
						<Label class="pe-label">封面图地址</Label>
						<div class="flex items-center gap-2">
							<Input bind:value={cover} placeholder="/uploads/cover.png" class="flex-1" />
							<Button type="button" variant="outline" size="sm" class="shrink-0 gap-1.5" onclick={() => openMedia("cover")}>
								<ImageIcon class="size-3.5" /> 媒体库
							</Button>
						</div>
						<p class="pe-hint">可从媒体库选择/上传，页头选「横幅」时作为背景图</p>
					</div>

					<div class="pe-field">
						<Label class="pe-label">页面图标</Label>
						<div class="flex items-center gap-2">
							<IconPicker value={icon} onpick={(n) => (icon = n)} triggerLabel={icon ? icon : "选择图标"} class="shrink-0" />
							{#if icon}
								<button type="button" class="pe-icon-btn" title="清除图标" onclick={() => (icon = "")}>✕</button>
							{/if}
						</div>
						<p class="pe-hint">用于导航/卡片上的图形化展示</p>
					</div>

					<div class="pe-field">
						<Label class="pe-label">主题色</Label>
						<div class="pe-accent-row">
							<input type="color" bind:value={accent} class="pe-color" />
							<Input bind:value={accent} placeholder="留空用站点主色" class="flex-1" />
							<button class="pe-icon-btn" title="清除" onclick={() => (accent = "")}>✕</button>
						</div>
					</div>

					<div class="pe-switches">
						<label class="pe-switch"><input type="checkbox" bind:checked={aside} /> 侧栏目录</label>
						<label class="pe-switch"><input type="checkbox" bind:checked={toc} /> 正文内目录</label>
						<label class="pe-switch"><input type="checkbox" bind:checked={hideTitle} /> 隐藏大标题</label>
						<label class="pe-switch"><input type="checkbox" bind:checked={noindex} /> 不参与搜索索引</label>
					</div>
				</div>
			</section>

			<section class="pe-card">
				<div class="pe-card-head static"><span class="flex items-center gap-2"><Columns2 class="size-3.5" /> 发布信息</span></div>
				<div class="pe-fields">
					<div class="pe-field">
						<Label class="pe-label">状态</Label>
						<Select.Root type="single" bind:value={status}>
							<Select.Trigger class="w-full">{status === "published" ? "已发布" : "草稿"}</Select.Trigger>
							<Select.Content>
								<Select.Item value="published" label="已发布" />
								<Select.Item value="draft" label="草稿" />
							</Select.Content>
						</Select.Root>
					</div>
					<div class="pe-field">
						<Label class="pe-label">导航短标题</Label>
						<Input bind:value={navTitle} placeholder="留空用页面标题" />
					</div>
					<div class="pe-field">
						<Label class="pe-label">分类</Label>
						<Input bind:value={category} placeholder="如：关于、推广" />
					</div>
					<div class="pe-field">
						<Label class="pe-label">标签</Label>
						<Input bind:value={tags} placeholder="逗号分隔" />
					</div>
					<div class="pe-field">
						<Label class="pe-label">摘要</Label>
						<textarea bind:value={excerpt} class="pe-textarea-sm" placeholder="一句话描述，用于列表页与分享卡片"></textarea>
					</div>
				</div>
			</section>
		</aside>
	</div>

	<!-- ═══ 站内文件引用（媒体库）弹层 ═══ -->
	{#if mediaShow}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onclick={(e) => { if (e.target === e.currentTarget) mediaShow = false; }}>
			<div class="w-full max-w-2xl rounded-xl border border-border/60 bg-background p-4 shadow-xl">
				<div class="mb-3 flex items-center justify-between">
					<h3 class="font-heading text-base font-semibold">选择图片（媒体库）</h3>
					<button onclick={() => (mediaShow = false)} class="text-muted-foreground hover:text-foreground">✕</button>
				</div>
				<p class="mb-3 text-xs text-muted-foreground">{mediaMode === "cover" ? "点击图片设为封面；也可上传新图片。" : "点击图片插入到正文；也可上传新图片。"}</p>
				<div class="mb-3 flex items-center gap-2">
					<Button size="sm" variant="outline" onclick={() => fileInput?.click()}>上传新图片</Button>
					{#if uploadingImg}<span class="text-xs text-muted-foreground">上传中…</span>{/if}
				</div>
				{#if mediaLoading}
					<p class="py-6 text-center text-sm text-muted-foreground">加载中…</p>
				{:else if mediaList.length === 0}
					<p class="py-6 text-center text-sm text-muted-foreground">媒体库暂无图片，点击上方上传</p>
				{:else}
					<div class="grid max-h-80 grid-cols-4 gap-2 overflow-y-auto">
						{#each mediaList as m (m.url)}
							<button type="button" onclick={() => pickMedia(m.url, m.filename)} class="group relative overflow-hidden rounded-lg border border-border/60 hover:border-primary/60">
								<img src={m.url} alt={m.filename} loading="lazy" class="aspect-square w-full object-cover" />
								<span class="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">{m.filename}</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{/if}
	<input type="file" bind:this={fileInput} accept="image/*" class="hidden" onchange={onMediaFile} />
</div>

<style>
	/* ── 整体：填满内容区，自身不产生页面级滚动（各栏独立滚） ── */
	.page-editor {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-height: 0;
	}

	/* ── 顶栏 ── */
	.pe-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.pe-icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		flex: 0 0 auto;
		border-radius: calc(var(--radius) * 0.8);
		border: 1px solid var(--border);
		color: var(--muted-foreground);
		transition: color .18s ease, border-color .18s ease, background-color .18s ease;
	}
	.pe-icon-btn:hover {
		color: var(--foreground);
		border-color: var(--primary);
		background: var(--accent);
	}
	/* 设备预览档位：分段控件 */
	.pe-device-group {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		padding: 2px;
		border-radius: calc(var(--radius) * 0.8);
		border: 1px solid var(--border);
		background: var(--muted);
	}
	.pe-device-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.9rem;
		height: 1.6rem;
		border-radius: calc(var(--radius) * 0.6);
		color: var(--muted-foreground);
		transition: background-color .18s ease, color .18s ease;
	}
	.pe-device-btn:hover { color: var(--foreground); }
	.pe-device-btn.on {
		background: var(--background);
		color: var(--foreground);
		box-shadow: 0 1px 2px var(--shadow-card);
	}

	/* ── 窄屏标签页（宽屏隐藏：三栏直接并列） ── */
	.pe-tabs { display: none; gap: 4px; padding: 3px; border-radius: calc(var(--radius) * 0.9); border: 1px solid var(--border); background: var(--muted); }
	.pe-tab {
		flex: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 7px 10px;
		border-radius: calc(var(--radius) * 0.7);
		font-size: 13px;
		font-weight: 500;
		color: var(--muted-foreground);
		transition: background-color .18s ease, color .18s ease;
	}
	.pe-tab.on {
		background: var(--background);
		color: var(--foreground);
		box-shadow: 0 1px 2px var(--shadow-card);
	}

	/* ── 三栏骨架 ──
	   宽屏：左 300 / 中 自适应 / 右 300。中栏吸收剩余空间，最窄 0 防溢出。 */
	.pe-body {
		display: grid;
		grid-template-columns: minmax(0, 300px) minmax(0, 1fr) minmax(0, 300px);
		gap: 0.75rem;
		align-items: start;
	}
	.pe-col { min-width: 0; display: flex; flex-direction: column; gap: 0.75rem; }

	/* 卡片：统一容器样式，全站后台一致 */
	.pe-card {
		border: 1px solid var(--border);
		border-radius: calc(var(--radius) * 1.5);
		background: var(--card);
		overflow: hidden;
	}
	.pe-card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 0.6rem 0.85rem;
		font-size: 12.5px;
		font-weight: 500;
		color: var(--foreground);
		border-bottom: 1px solid var(--border);
		transition: background-color .18s ease;
	}
	button.pe-card-head:hover { background: var(--accent); }
	.pe-card-head.static { cursor: default; }

	/* ── 模板列表 ── */
	.pe-tpl-list { display: flex; flex-direction: column; padding: 0.35rem; }
	.pe-tpl {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.5rem 0.55rem;
		border-radius: calc(var(--radius) * 0.8);
		transition: background-color .18s ease;
	}
	.pe-tpl:hover { background: var(--accent); }

	/* ── 预览 ── */
	.pe-preview-wrap { padding: 0.6rem; }
	.pe-preview {
		margin: 0 auto;
		width: 100%;
		max-height: 320px;
		overflow: auto;
		border: 1px solid var(--border);
		border-radius: calc(var(--radius) * 0.9);
		background: var(--background);
		transition: max-width .25s ease;
	}
	.pe-preview-inner { padding: 0.9rem; }
	.pe-preview-inner.is-full { padding: 0.4rem; }
	.pe-pv-banner {
		height: 64px;
		margin: -0.9rem -0.9rem 0.7rem;
		background-size: cover;
		background-position: center;
	}
	.pe-pv-title {
		font-family: var(--font-heading);
		font-size: 1.1rem;
		font-weight: 600;
		margin-bottom: 0.5rem;
		color: var(--foreground);
	}
	.pe-pv-body { font-size: 12px; line-height: 1.7; color: var(--prose-body, var(--foreground)); }
	.pe-pv-empty { font-size: 12px; color: var(--muted-foreground); }
	.pe-hint { margin-top: 0.4rem; font-size: 11px; line-height: 1.5; color: var(--muted-foreground); }

	/* ── 中栏：正文 ── */
	.pe-center { position: sticky; top: 0; }
	.pe-field { display: flex; flex-direction: column; gap: 0.4rem; }
	.pe-title-input {
		height: auto;
		padding: 0.7rem 0.9rem;
		font-size: 1.05rem;
		font-family: var(--font-heading);
		font-weight: 600;
	}
	.pe-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 2px;
		padding: 0.25rem;
		border: 1px solid var(--border);
		border-radius: calc(var(--radius) * 0.9);
		background: var(--card);
	}
	.pe-tb-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.9rem;
		height: 1.7rem;
		border-radius: calc(var(--radius) * 0.6);
		color: var(--muted-foreground);
		transition: background-color .16s ease, color .16s ease;
	}
	.pe-tb-btn:hover { background: var(--accent); color: var(--foreground); }
	.pe-tb-btn:active { transform: scale(0.94); }
	.pe-textarea {
		width: 100%;
		/* 用 vh 而非固定 px：编辑器自身不滚动，正文区高度跟随视口，
		   笔记本与带鱼屏都不会出现"框太短写两行就要滚"的问题。 */
		min-height: max(420px, calc(100vh - 260px));
		padding: 1rem 1.1rem;
		border: 1px solid var(--border);
		border-radius: calc(var(--radius) * 1.2);
		background: var(--card);
		color: var(--foreground);
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 13.5px;
		line-height: 1.75;
		resize: vertical;
		field-sizing: content;
	}
	.pe-textarea:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
	.pe-textarea-sm {
		width: 100%;
		min-height: 72px;
		padding: 0.55rem 0.65rem;
		border: 1px solid var(--border);
		border-radius: calc(var(--radius) * 0.8);
		background: var(--background);
		color: var(--foreground);
		font-size: 13px;
		line-height: 1.6;
		resize: vertical;
	}

	/* ── 右栏字段 ── */
	.pe-fields { display: flex; flex-direction: column; gap: 0.85rem; padding: 0.85rem; }
	.pe-label { font-size: 12px; font-weight: 500; color: var(--muted-foreground); }

	/* 版心四选一：用宽度示意条让"窄/标准/宽/全"一眼可辨 */
	.pe-layout-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
	.pe-layout-opt {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 5px;
		padding: 0.45rem 0.2rem 0.35rem;
		border: 1px solid var(--border);
		border-radius: calc(var(--radius) * 0.8);
		color: var(--muted-foreground);
		transition: border-color .18s ease, color .18s ease, background-color .18s ease;
	}
	.pe-layout-opt:hover { border-color: var(--primary); color: var(--foreground); }
	.pe-layout-opt.on {
		border-color: var(--primary);
		background: color-mix(in oklab, var(--primary) 10%, transparent);
		color: var(--primary);
	}
	.pe-layout-bar {
		display: block;
		height: 14px;
		border-radius: 2px;
		background: currentColor;
		opacity: 0.55;
	}
	.pe-layout-bar[data-w="narrow"] { width: 42%; }
	.pe-layout-bar[data-w="standard"] { width: 62%; }
	.pe-layout-bar[data-w="wide"] { width: 80%; }
	.pe-layout-bar[data-w="full"] { width: 96%; }

	.pe-accent-row { display: flex; align-items: center; gap: 0.45rem; }
	.pe-color {
		width: 2.1rem;
		height: 2.1rem;
		flex: 0 0 auto;
		padding: 2px;
		border: 1px solid var(--border);
		border-radius: calc(var(--radius) * 0.7);
		background: var(--background);
		cursor: pointer;
	}
	.pe-switches { display: flex; flex-direction: column; gap: 0.5rem; }
	.pe-switch {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 13px;
		color: var(--muted-foreground);
		cursor: pointer;
	}
	.pe-switch input { accent-color: var(--primary); }

	/* ── 响应式 ──
	   1440 以上三栏；1024–1440 收窄侧栏；1024 以下改双栏（正文 + 右栏换行）；
	   860 以下用标签页切换 —— 这是"自适应布局/响应式设计"的落点。 */
	@media (max-width: 1440px) {
		.pe-body { grid-template-columns: minmax(0, 260px) minmax(0, 1fr) minmax(0, 260px); }
	}
	@media (max-width: 1120px) {
		.pe-tabs { display: flex; }
		.pe-body { grid-template-columns: minmax(0, 1fr); }
		/* 单栏模式下由标签页控制显示 */
		.pe-col.hide-narrow { display: none; }
		.pe-center { position: static; }
		.pe-textarea { min-height: 60vh; }
	}
	@media (max-width: 640px) {
		.pe-header { gap: 0.5rem; }
		/* 窄屏把设备预览档位藏掉：手机上没有"桌面预览"的意义 */
		.pe-device-group { display: none; }
	}
	@media (prefers-reduced-motion: reduce) {
		.pe-preview, .pe-tab, .pe-tpl, .pe-icon-btn, .pe-device-btn, .pe-tb-btn, .pe-layout-opt {
			transition: none;
		}
		.pe-tb-btn:active { transform: none; }
	}
</style>
