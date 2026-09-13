<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import { Textarea } from "$lib/components/ui/textarea/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import * as Select from "$lib/components/ui/select/index.js";
	import { Save, ArrowLeft, Bold, Italic, Strikethrough, Heading2, Quote, List, ListOrdered, ListTodo, Table, Minus, Code, SquareCode, Link as LinkIcon, Image as ImageIcon, CornerDownLeft, ChevronRight, MonitorPlay } from "@lucide/svelte";
	import { toast } from "svelte-sonner";
	import { page } from "$app/state";

	let {
		section = "posts",
		slug = "new",
		backUrl = "/admin/posts"
	}: {
		section?: "posts" | "projects" | "docs" | "pages";
		slug?: string;
		backUrl?: string;
	} = $props();

	let title = $state("");
	let body = $state("");
	let excerpt = $state("");
	let category = $state("");
	let tags = $state("");
	let status = $state<"published" | "draft">("published");
	let repoUrl = $state("");
	let siteUrl = $state("");
	let folder = $state("");
	let previewHtml = $state("");
	let bodyEl: HTMLTextAreaElement | undefined = $state(undefined);
	let saving = $state(false);
	let saved = $state(false);
	let loaded = $state(false);
	let savedSlug = $state("");
	let fileInput: HTMLInputElement | undefined = $state(undefined);
	let uploadingImg = $state(false);
	let tableShow = $state(false);
	let tableRows = $state(3);
	let tableCols = $state(4);
	let mediaShow = $state(false);
	let mediaList = $state<any[]>([]);
	let mediaLoading = $state(false);

	const apiPath = $derived("/api/" + section);

	$effect(() => {
		if (slug === "new" && !folder) {
			const q = page.url.searchParams.get("folder");
			if (q) folder = q;
		}
		if (slug !== "new" && !loaded) load();
	});

	async function load() {
		try {
			const res = await fetch(apiPath + "?action=get&slug=" + encodeURIComponent(slug));
			if (!res.ok) return;
			const item = await res.json();
			title = item.title || ""; body = item.body || ""; excerpt = item.excerpt || "";
			category = item.category || ""; tags = (item.tags || []).join(", "); status = item.status || "published";
			repoUrl = item.repoUrl || ""; siteUrl = item.siteUrl || "";
			loaded = true;
		} catch (e) { console.error(e); }
	}

	async function renderPreview() {
		if (!body) { previewHtml = ""; return; }
		try {
			const res = await fetch(apiPath, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) });
			previewHtml = (await res.json()).html;
		} catch (e) { console.error(e); }
	}

	async function save(redirect = false) {
		if (!title.trim() || !body.trim()) return;
		saving = true; saved = false;
		try {
			const tagsArr = tags.split(",").map(t => t.trim()).filter(Boolean);
			const payload: Record<string, unknown> = { title, body, excerpt, category: category || undefined, tags: tagsArr.length ? tagsArr : undefined, status };
			if (slug !== "new") payload.slug = slug;
			if (repoUrl) payload.repoUrl = repoUrl;
			if (siteUrl) payload.siteUrl = siteUrl;
			if (folder) payload.folder = folder;
			const res = await fetch(apiPath, { method: "POST", headers: { "Content-Type": "application/json", "x-action": "save" }, body: JSON.stringify(payload) });
			const result = await res.json();
			if (res.ok) {
				savedSlug = result.slug || ""; saved = true;
				toast.success("已保存");
				// Auto-index: refresh backend list on next visit so newly saved items appear immediately
				localStorage.setItem("acofork_need_refresh", "1");
				setTimeout(() => { saved = false; }, 2500);
				if (redirect && result.slug) window.location.href = backUrl;
			} else {
				toast.error("保存失败，请重试");
			}
		} catch (e) { console.error(e); toast.error("保存失败，请重试"); }
		saving = false;
	}

	let debounceTimer: ReturnType<typeof setTimeout> | undefined;
	function onBodyChange() { clearTimeout(debounceTimer); debounceTimer = setTimeout(renderPreview, 350); }

	const isProject = $derived(section === "projects");
// ===== Toolbar tools =====
	function insertAtCursor(before: string, after = before, placeholder = "文本", placeholderSel = true) {
		const el = bodyEl;
		if (!el) return;
		const start = el.selectionStart ?? body.length;
		const end = el.selectionEnd ?? body.length;
		const sel = body.slice(start, end) || (placeholderSel ? placeholder : "");
		body = body.slice(0, start) + before + sel + after + body.slice(end);
		requestAnimationFrame(() => {
			el.focus();
			el.selectionStart = start + before.length;
			el.selectionEnd = start + before.length + (placeholderSel ? sel.length : 0);
		});
		onBodyChange();
	}

	function toolbarBold() { insertAtCursor("**", "**", "加粗文字"); }
	function toolbarItalic() { insertAtCursor("*", "*", "斜体文字"); }
	function toolbarStrike() { insertAtCursor("~~", "~~", "删除线"); }
	function toolbarInlineCode() { insertAtCursor("`", "`", "code"); }
	function toolbarCodeBlock() { insertAtCursor("```\n", "\n```", "代码"); }
	function toolbarLink() { insertAtCursor("[", "](https://)", "链接文字"); }
	function toolbarH2() { insertAtCursor("## ", "", "二级标题"); }
	function toolbarQuote() { insertAtCursor("> ", "", "引用内容"); }
	function toolbarList() { insertAtCursor("- ", "", "列表项"); }
	function toolbarOrderedList() { insertAtCursor("1. ", "", "列表项"); }
	function toolbarTodoList() { insertAtCursor("- [ ] ", "", "待办事项"); }
	function toolbarTable() { tableShow = true; }
	function insertTable() {
		const r = Math.max(1, Math.min(10, tableRows));
		const c = Math.max(1, Math.min(8, tableCols));
		const header = "| " + Array.from({ length: c }, (_, i) => "列" + (i + 1)).join(" | ") + " |";
		const sep = "| " + Array.from({ length: c }, () => "----").join(" | ") + " |";
		const rows = Array.from({ length: r }, () => "| " + Array.from({ length: c }, () => "内容").join(" | ") + " |");
		insertAtCursor("\n\n" + [header, sep, ...rows].join("\n") + "\n\n", "", "", false);
		tableShow = false;
	}
	function toolbarDivider() { insertAtCursor("\n---\n", "", "", false); }

	// ===== Image upload =====
	async function onFilePick(e: Event) {
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
				// 上传成功后直接插入正文并关闭弹窗，避免「传了却看不到效果」的错觉。
				const alt = file.name.replace(/\.[^.]+$/, "");
				insertAtCursor("\n\n![" + alt + "](" + data.url + ")\n\n", "", "", false);
				mediaShow = false;
				toast.success("图片已上传并插入");
				loadMedia();
			} else {
				toast.error(data.error || "上传失败");
			}
		} catch (err) { toast.error("上传失败"); }
		uploadingImg = false;
	}


	// ===== Media library image picker =====
	async function openMediaPicker() {
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
	function pickMedia(url: string, alt: string) {
		insertAtCursor("\n\n![" + alt + "](" + url + ")\n\n", "", "", false);
		mediaShow = false;
		toast.success("已插入图片");
	}

	// ===== Website embed (iframe video / page) =====
	function embedUrlToIframe(input: string): string | null {
		const t = input.trim();
		if (!t) return null;
		// User pasted raw HTML already
		if (t.startsWith("<iframe") || t.startsWith("<video")) return t;
		try {
			const u = new URL(t);
			// YouTube: https://www.youtube.com/watch?v=ID / youtu.be/ID / embed/ID
			const yt = u.hostname.match(/(^|\.)youtube\.com$|youtu\.be/) ? (u.searchParams.get("v") || u.pathname.split("/").pop()) : null;
			if (yt) return `<iframe src="https://www.youtube.com/embed/${yt}" class="w-full" style="aspect-ratio:16/9" frameborder="0" allowfullscreen title="YouTube 嵌入"></iframe>`;
			// Bilibili: https://www.bilibili.com/video/BVxxxx
			if (u.hostname.includes("bilibili.com") && (u.pathname.startsWith("/video/") || u.hostname.startsWith("player."))) {
				const bvid = u.pathname.match(/\/video\/([A-Za-z0-9]+)/)?.[1] || u.searchParams.get("bvid") || "";
				if (bvid) return `<iframe src="//player.bilibili.com/player.html?bvid=${bvid}&page=1" class="w-full" style="aspect-ratio:16/9" frameborder="0" scrolling="no" allowfullscreen title="哔哩哔哩嵌入"></iframe>`;
			}
			// Vimeo
			if (u.hostname.includes("vimeo.com")) {
				const vid = u.pathname.split("/").filter(Boolean)[0] || "";
				if (vid) return `<iframe src="https://player.vimeo.com/video/${vid}" class="w-full" style="aspect-ratio:16/9" frameborder="0" allowfullscreen title="Vimeo 嵌入"></iframe>`;
			}
			// Generic page
			return `<iframe src="${u.href}" class="w-full" style="height:420px" frameborder="0" allowfullscreen sandbox="allow-scripts allow-same-origin allow-popups" title="网页嵌入"></iframe>`;
		} catch (e) {
			return null;
		}
	}

	function toolbarEmbed() {
		const choice = prompt("选择嵌入类型：\n1 = 视频/网页 URL\n2 = Bilibili 视频\n3 = 粘贴 iframe 代码", "1");
		if (!choice) return;
		const url = choice === "3" ? prompt("粘贴 iframe / video 代码：") : prompt("粘贴 URL：", "https://");
		if (!url) return;
		const iframe = embedUrlToIframe(choice === "3" ? url : url);
		if (!iframe) { toast.error("无法识别的地址"); return; }
		insertAtCursor("\n\n" + iframe + "\n\n", "", "", false);
	}
	// ===== Slash command menu =====
	interface SlashCmd { label: string; icon: string; run: () => void; keywords: string[]; }
	let slashOpen = $state(false);
	let slashIdx = $state(0);
	let slashY = $state(30);
	let slashX = $state(0);
	let slashQuery = $state("");

	const slashCommands: SlashCmd[] = [
		{ label: "二级标题", icon: "H2", keywords: ["h2", "标题", "heading"], run: toolbarH2 } as SlashCmd,
		{ label: "无序列表", icon: "•", keywords: ["ul", "list", "列表"], run: toolbarList } as SlashCmd,
		{ label: "有序列表", icon: "1.", keywords: ["ol", "ordered", "有序"], run: toolbarOrderedList } as SlashCmd,
		{ label: "任务列表", icon: "☑", keywords: ["todo", "task", "任务"], run: toolbarTodoList } as SlashCmd,
		{ label: "引用", icon: "❝", keywords: ["quote", "引用"], run: toolbarQuote } as SlashCmd,
		{ label: "行内代码", icon: "`", keywords: ["code", "inline", "行内代码"], run: toolbarInlineCode } as SlashCmd,
		{ label: "代码块", icon: "{ }", keywords: ["codeblock", "代码块", "pre"], run: toolbarCodeBlock } as SlashCmd,
		{ label: "表格", icon: "▦", keywords: ["table", "表"], run: toolbarTable } as SlashCmd,
		{ label: "分隔线", icon: "—", keywords: ["hr", "divider", "分割线"], run: toolbarDivider } as SlashCmd,
		{ label: "链接", icon: "🔗", keywords: ["link", "链接"], run: toolbarLink } as SlashCmd,
		{ label: "插入图片（媒体库/上传）", icon: "🖼", keywords: ["image", "img", "图", "图片"], run: openMediaPicker } as SlashCmd,
		{ label: "嵌入（视频/网页）", icon: "🎞", keywords: ["embed", "video", "youtube", "bilibili", "视频", "嵌入"], run: toolbarEmbed } as SlashCmd,
	];

	const slashFiltered = $derived(slashQuery ? slashCommands.filter(c => c.label.toLowerCase().includes(slashQuery.toLowerCase()) || c.keywords.some(k => k.toLowerCase().includes(slashQuery.toLowerCase()))) : slashCommands);

	function onEditorKeydown(e: KeyboardEvent) {
		const el = bodyEl;
		if (!el) return;
		if (slashOpen) {
			if (e.key === "ArrowDown") { e.preventDefault(); slashIdx = Math.min(slashIdx + 1, slashFiltered.length - 1); return; }
			if (e.key === "ArrowUp") { e.preventDefault(); slashIdx = Math.max(slashIdx - 1, 0); return; }
			if (e.key === "Enter") { e.preventDefault(); const c = slashFiltered[slashIdx]; if (c) { runSlash(c); } return; }
			if (e.key === "Escape") { slashOpen = false; return; }
		}
		if (e.key === "/") {
			// Only open at start of line or after whitespace
			const caret = el.selectionStart ?? 0;
			const lineStart = body.lastIndexOf("\n", caret - 1) + 1;
			const beforeCaret = body.slice(lineStart, caret);
			if (beforeCaret.trim() === "") {
				// Check the char just before caret is not text (open on plain /)
				if (caret === 0 || body[caret - 1] === "\n" || /\s/.test(body[caret - 1] || "")) {
					const rect = el.getBoundingClientRect();
					slashX = Math.min(Math.max(el.clientWidth - 224, 0), 200);
					slashY = Math.min(el.clientHeight - 40, 90);
					slashOpen = true; slashIdx = 0; slashQuery = "";
				}
			}
		} else if (slashOpen && e.key.length === 1 && /^[\w\u4e00-\u9fff]$/.test(e.key)) {
			slashQuery += e.key;
			slashIdx = 0;
		} else if (slashOpen && e.key === "Backspace" && slashQuery) {
			slashQuery = slashQuery.slice(0, -1);
			slashIdx = 0;
		}
	}

	function runSlash(cmd: SlashCmd) {
		// Remove the typed "/" + query from the line start
		const el = bodyEl;
		if (el) {
			const caret = el.selectionStart ?? 0;
			const lineStart = body.lastIndexOf("\n", caret - 1) + 1;
			const beforeCaret = body.slice(lineStart, caret);
			const removeLen = beforeCaret.length;
			if (removeLen > 0) {
				body = body.slice(0, lineStart) + body.slice(lineStart + removeLen);
				const newCaret = lineStart;
				requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = newCaret; });
			}
		}
		slashOpen = false;
		cmd.run();
	}

	function closeSlash() { slashOpen = false; }

</script>


<div class="mb-6">
	<a href={backUrl} class="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2">
		<ArrowLeft class="h-4 w-4" /> 返回列表
	</a>
	<h1 class="text-2xl font-heading font-semibold">{slug === "new" ? "新建内容" : "编辑：" + title}</h1>
</div>

<div class="space-y-4">
	<div class="grid gap-2">
		<Label>标题</Label>
		<Input placeholder="标题" bind:value={title} />
	</div>
	<div class="grid grid-cols-3 gap-4">
		{#if section === "docs"}<div class="grid gap-2"><Label>文件夹</Label><Input placeholder="例如：AI 入门" bind:value={folder} /></div>{/if}
		<div class="grid gap-2"><Label>分类</Label><Input placeholder="开发、追番..." bind:value={category} /></div>
		<div class="grid gap-2"><Label>标签（逗号分隔）</Label><Input placeholder="AI, Svelte" bind:value={tags} /></div>
		<div class="grid gap-2"><Label>状态</Label><Select.Root type="single" bind:value={status}>
			<Select.Trigger class="w-full">{({ published: "已发布", draft: "草稿" })[status] ?? status}</Select.Trigger>
			<Select.Content>
				<Select.Item value="published" label="已发布" />
				<Select.Item value="draft" label="草稿" />
			</Select.Content>
		</Select.Root></div>
	</div>
{#if isProject}
	<div class="grid grid-cols-2 gap-4">
		<div class="grid gap-2"><Label>GitHub 仓库</Label><Input placeholder="https://github.com/..." bind:value={repoUrl} /></div>
		<div class="grid gap-2"><Label>项目站点</Label><Input placeholder="https://..." bind:value={siteUrl} /></div>
	</div>
{/if}
	<div class="grid gap-2">
		<Label>摘要</Label>
		<Textarea placeholder="摘要（可选）" bind:value={excerpt} rows={2} />
	</div>

	<div class="grid gap-2">
		<div class="flex items-center justify-between"><Label>正文（Markdown · 左侧编辑，右侧实时预览）</Label></div>
		<!-- Toolbar (Halo-style) -->
		<div class="flex flex-wrap items-center gap-0.5 rounded-md border border-border/60 bg-muted/30 p-1">
			<button type="button" onclick={toolbarBold} class="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="加粗"><Bold class="size-4" /></button>
			<button type="button" onclick={toolbarItalic} class="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="斜体"><Italic class="size-4" /></button>
			<button type="button" onclick={toolbarStrike} class="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="删除线"><Strikethrough class="size-4" /></button>
			<span class="mx-1 h-4 w-px bg-border"></span>
			<button type="button" onclick={toolbarH2} class="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="二级标题"><Heading2 class="size-4" /></button>
			<button type="button" onclick={toolbarQuote} class="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="引用"><Quote class="size-4" /></button>
			<button type="button" onclick={toolbarList} class="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="无序列表"><List class="size-4" /></button>
			<button type="button" onclick={toolbarOrderedList} class="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="有序列表"><ListOrdered class="size-4" /></button>
			<button type="button" onclick={toolbarTodoList} class="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="任务列表"><ListTodo class="size-4" /></button>
			<button type="button" onclick={toolbarTable} class="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="表格"><Table class="size-4" /></button>
			<button type="button" onclick={toolbarDivider} class="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="分隔线"><Minus class="size-4" /></button>
			<span class="mx-1 h-4 w-px bg-border"></span>
			<button type="button" onclick={toolbarInlineCode} class="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="行内代码"><Code class="size-4" /></button>
			<button type="button" onclick={toolbarCodeBlock} class="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="代码块"><SquareCode class="size-4" /></button>
			<button type="button" onclick={toolbarLink} class="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="链接"><LinkIcon class="size-4" /></button>
			<button type="button" onclick={toolbarEmbed} class="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="嵌入（视频/网页/B站）"><MonitorPlay class="size-4" /></button>
			<button type="button" onclick={openMediaPicker} class="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="插入图片（媒体库/上传）"><ImageIcon class="size-4" /></button>
		</div>
		<input type="file" accept="image/*" class="hidden" bind:this={fileInput} onchange={onFilePick} />

		<!-- Table size picker -->
		{#if tableShow}
			<div class="mb-2 flex items-center gap-3 rounded-md border border-border/60 bg-muted/30 p-2">
				<label class="flex items-center gap-2 text-xs">行 <input type="number" min="1" max="10" bind:value={tableRows} class="h-7 w-14 rounded border bg-background px-2 text-sm" /></label>
				<label class="flex items-center gap-2 text-xs">列 <input type="number" min="1" max="8" bind:value={tableCols} class="h-7 w-14 rounded border bg-background px-2 text-sm" /></label>
				<Button size="sm" onclick={insertTable}>插入表格</Button>
				<Button size="sm" variant="ghost" onclick={() => (tableShow = false)}>取消</Button>
			</div>
		{/if}

		<!-- Media library picker -->
		{#if mediaShow}
			<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onclick={(e) => { if (e.target === e.currentTarget) mediaShow = false; }}>
				<div class="w-full max-w-2xl rounded-xl border border-border/60 bg-background p-4 shadow-xl">
					<div class="mb-3 flex items-center justify-between">
						<h3 class="font-heading text-base font-semibold">选择图片（媒体库）</h3>
						<button onclick={() => (mediaShow = false)} class="text-muted-foreground hover:text-foreground">✕</button>
					</div>
					<p class="mb-3 text-xs text-muted-foreground">点击任意图片即可插入到正文；也可上传新图片。</p>
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
								<button type="button" onclick={() => pickMedia(m.url, m.filename.replace(/\.[^.]+$/, ""))} class="group relative overflow-hidden rounded-lg border border-border/60 hover:border-primary/60">
									<img src={m.url} alt={m.filename} loading="lazy" class="aspect-square w-full object-cover" />
									<span class="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">{m.filename}</span>
								</button>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		{/if}
		<div class="grid gap-0 overflow-hidden rounded-lg border border-border/60 md:grid-cols-2">
			<div class="relative">
				<textarea
					bind:this={bodyEl}
					bind:value={body}
					oninput={onBodyChange}
					onkeydown={onEditorKeydown}
					rows={22}
					placeholder="输入 / 可唤起快捷工具；支持 Markdown 语法"
					class="h-[480px] resize-none border-0 bg-background p-4 font-mono text-sm outline-none focus:ring-0 md:border-r md:border-border/60"
				></textarea>
				<!-- Slash command menu -->
				{#if slashOpen}
					<div class="absolute z-20 mt-1 max-h-72 w-56 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg" style="top: {slashY}px; left: {slashX}px;">
						{#each slashFiltered as cmd, ci (cmd.label)}
							<button type="button" onclick={() => runSlash(cmd)} onmouseenter={() => (slashIdx = ci)} class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm {ci === slashIdx ? 'bg-accent' : ''}">
								<span class="w-6 text-center text-muted-foreground">{cmd.icon}</span>
								<span>{cmd.label}</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>
			<div class="prose prose-invert max-w-none h-[480px] overflow-y-auto border-0 bg-card/40 p-4">
				{@html previewHtml || "<p class=\"text-muted-foreground\">开始输入，右侧会实时预览排版效果…</p>"}
			</div>
		</div>
		<div class="flex items-center justify-between">
			<p class="text-xs text-muted-foreground">支持 Markdown：标题、加粗、列表、表格、代码块、引用、链接；输入 <kbd class="rounded border border-border px-1">/</kbd> 唤起快捷工具；保存后自动索引刷新。</p>
			{#if uploadingImg}<span class="text-xs text-muted-foreground">图片上传中…</span>{/if}
		</div>
	</div>

	<div class="flex items-center gap-3">
		<Button onclick={() => save(true)} disabled={saving || !title.trim() || !body.trim()}>
			<Save class="h-4 w-4 mr-2" /> {saving ? "保存中..." : "保存并返回"}
		</Button>
		<Button variant="outline" onclick={() => save(false)} disabled={saving || !title.trim() || !body.trim()}>继续编辑</Button>
		{#if saved}<Badge variant="secondary">已保存</Badge>{/if}
	</div>
</div>