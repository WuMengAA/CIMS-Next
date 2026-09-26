<script lang="ts">
	/**
	 * 个人附件库 / 图床（/library）。
	 *
	 * 一句话定位：**每个账号一间自己的仓库**——别人翻不到你的一张图，
	 * 但你可以在里面建文件夹、一键压缩、加水印、拿一条外链贴到任何地方（图床）。
	 *
	 * 页面上所有列表操作都先调 API 再本地更新，不做"乐观渲染"：
	 * 这类界面最忌"界面显示已删除、刷新又回来了"，宁可多一次往返。
	 */
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Switch } from "$lib/components/ui/switch/index.js";
	import { toast } from "svelte-sonner";
	import { confirmDelete } from "$lib/components/admin/confirm.svelte";
	import { formatBytes } from "$lib/storage-quota.js";
	import {
		ImageUp, Loader2, Search, Grid3x3, List, FolderPlus, Folder as FolderIcon, Trash2, Copy,
		Wand2, Undo2, Settings2, Link2, MoveRight, HardDrive, AlertTriangle, Check
	} from "@lucide/svelte";

	type ServerData = import("./$types").PageData;
	let { data }: { data: ServerData } = $props();

	type File = {
		id: string; folderId: string | null; filename: string; url: string; mime: string;
		bytes: number; width: number | null; height: number | null; isImage: boolean;
		watermark: boolean; variant: string; hasOriginal: boolean; originalBytes: number;
		purpose: string; createdAt: string;
	};
	type Folder = { id: string; name: string; parentId: string | null; purpose: string; createdAt: string };

	let folders = $state<Folder[]>(data.folders);
	let files = $state<File[]>(data.files);
	let usage = $state(data.usage);
	let storageConfigured = $state(data.storage.configured);

	let activeFolder = $state<string>("root"); // root = 所有文件（不过滤）
	let kind = $state<"all" | "image" | "file">("all");
	let query = $state("");
	let view = $state<"grid" | "list">("grid");
	let loading = $state(false);

	// 上传区
	let fileInput: HTMLInputElement | null = $state(null);
	let uploadFormat = $state<"avif" | "webp" | "original">("avif");
	let uploadWatermark = $state(true);
	let keepOriginal = $state(true);
	let uploading = $state(false);
	let dragOver = $state(false);

	// ⚠️ 这里的 pendingFiles 只做「已选中未上传」的本地排队，实际压缩在服务端做。
	// 早期版本在浏览器里先压缩再上传，结果同一张图两边算出的体积不一样，配额对不上。
	let pendingNames = $state<string[]>([]);

	// 每行的处理中状态（用 id 作 key，避免并发操作时互相打断）
	let busy = $state<Record<string, boolean>>({});
	let renameId = $state<string | null>(null);
	let renameText = $state("");

	const visible = $derived.by(() => {
		let out = files;
		if (activeFolder !== "root") out = out.filter((f) => f.folderId === activeFolder);
		if (kind === "image") out = out.filter((f) => f.isImage);
		if (kind === "file") out = out.filter((f) => !f.isImage);
		const q = query.trim().toLowerCase();
		if (q) out = out.filter((f) => f.filename.toLowerCase().includes(q) || f.url.toLowerCase().includes(q));
		return out;
	});

	const images = $derived(files.filter((f) => f.isImage));
	const percent = $derived(Math.min(100, usage.percent));

	async function refresh() {
		loading = true;
		try {
			const sp = new URLSearchParams({ kind });
			if (activeFolder !== "root") sp.set("folder", activeFolder);
			if (query.trim()) sp.set("q", query.trim());
			const res = await fetch(`/api/library?${sp}`);
			const d = await res.json();
			if (!res.ok) throw new Error(d.error || "加载失败");
			files = d.files; folders = d.folders; usage = d.usage;
			storageConfigured = d.storage.provider === "cloudflare-r2";
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		} finally {
			loading = false;
		}
	}

	// ── 上传 ────────────────────────────────────────────────────────────────
	async function upload(filesToSend: FileList | null) {
		if (!filesToSend || !filesToSend.length) return;
		if (!storageConfigured) {
			toast.error("存储尚未配置：请在 .env 里补上 R2_* 四个变量");
			return;
		}
		uploading = true;
		pendingNames = Array.from(filesToSend).map((f) => f.name);
		let ok = 0;
		let failed = 0;
		for (const f of Array.from(filesToSend)) {
			const form = new FormData();
			form.set("file", f, f.name);
			form.set("format", uploadFormat);
			form.set("watermark", uploadWatermark ? "on" : "off");
			form.set("keepOriginal", keepOriginal ? "1" : "0");
			try {
				const res = await fetch("/api/library", { method: "POST", body: form });
				const d = await res.json().catch(() => ({}));
				if (!res.ok || !d.ok) throw new Error(d.error || "上传失败");
				files = [d.file, ...files];
				usage = d.usage ?? usage;
				ok++;
				if (d.compressionRatio != null && d.compressionRatio < 1) {
					toast.success(`${f.name} · 已压缩至 ${Math.round(d.compressionRatio * 100)}%`);
				}
			} catch (e) {
				failed++;
				toast.error(`${f.name}：${e instanceof Error ? e.message : String(e)}`);
			}
		}
		toast.success(`上传完成：成功 ${ok}${failed ? `，失败 ${failed}` : ""}`);
		uploading = false;
		pendingNames = [];
		if (fileInput) fileInput.value = "";
		await refresh();
	}

	function onDrop(e: DragEvent) {
		dragOver = false;
		if (e.dataTransfer?.files?.length) upload(e.dataTransfer.files);
	}

	// ── 目录 ────────────────────────────────────────────────────────────────
	async function addFolder() {
		const name = prompt("新文件夹名称");
		if (!name) return;
		const parentId = activeFolder === "root" ? null : activeFolder;
		const res = await fetch("/api/library/folder", {
			method: "POST",
			body: new URLSearchParams({ name, parentId: parentId ?? "" })
		});
		const d = await res.json().catch(() => ({}));
		if (!res.ok || !d.ok) return toast.error(d.error || "创建失败");
		folders = [...folders, d.folder];
		toast.success("文件夹已创建");
	}

	async function renameFolderNow(id: string) {
		const name = prompt("重命名文件夹");
		if (!name) return;
		const res = await fetch(`/api/library/folder/${id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name })
		});
		if (!res.ok) return toast.error("重命名失败");
		folders = folders.map((f) => (f.id === id ? { ...f, name } : f));
	}

	async function removeFolder(id: string) {
		const target = folders.find((f) => f.id === id);
		if (!(await confirmDelete(`删除目录「${target?.name ?? ""}」`, "目录里的文件会一并从存储中删除，且不可恢复。"))) return;
		const res = await fetch(`/api/library/folder/${id}`, { method: "DELETE" });
		const d = await res.json().catch(() => ({}));
		if (!res.ok) return toast.error(d.error || "删除失败");
		folders = folders.filter((f) => f.id !== id);
		files = files.filter((f) => f.folderId !== id);
		toast.success(`已删除，清理 ${d.removedFiles ?? 0} 个文件`);
	}

	// ── 文件操作 ────────────────────────────────────────────────────────────
	async function copyText(text: string, label = "已复制") {
		try {
			await navigator.clipboard.writeText(text);
			toast.success(label);
		} catch {
			// 非安全上下文下 clipboard API 不可用（http 直连），退回老办法
			const ta = document.createElement("textarea");
			ta.value = text;
			document.body.appendChild(ta);
			ta.select();
			try { document.execCommand("copy"); toast.success(label); } catch { toast.error("复制失败，请手动选中"); }
			ta.remove();
		}
	}

	function copyMarkdown(f: File) { copyText(`![](${f.url})`, "Markdown 已复制"); }
	function copyHtml(f: File) { copyText(`<img src="${f.url}" alt="${f.filename}" />`, "HTML 已复制"); }
	function copyUrl(f: File) { copyText(f.url, "外链已复制"); }

	async function renameFileNow(f: File) {
		renameId = f.id;
		renameText = f.filename;
	}
	async function commitRename() {
		if (!renameId) return;
		const res = await fetch(`/api/library/${renameId}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ filename: renameText })
		});
		const d = await res.json().catch(() => ({}));
		if (!res.ok) toast.error(d.error || "重命名失败");
		else files = files.map((x) => (x.id === renameId ? { ...x, filename: renameText } : x));
		renameId = null;
	}

	async function moveFile(f: File) {
		const options = folders.map((x) => `${x.name}（${x.id}）`).join("\n");
		const input = prompt(`移动到（粘贴目录 id，留空表示移到根目录）：\n${options}`, f.folderId ?? "");
		if (input === null) return;
		const target = input.trim() || null;
		const res = await fetch(`/api/library/${f.id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ folderId: target })
		});
		const d = await res.json().catch(() => ({}));
		if (!res.ok) return toast.error(d.error || "移动失败");
		files = files.map((x) => (x.id === f.id ? { ...x, folderId: target } : x));
		toast.success("已移动");
	}

	async function toggleWatermark(f: File) {
		const next = !f.watermark;
		const res = await fetch(`/api/library/${f.id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ watermark: next })
		});
		const d = await res.json().catch(() => ({}));
		if (!res.ok) return toast.error(d.error || "设置失败");
		files = files.map((x) => (x.id === f.id ? { ...x, watermark: next } : x));
		toast.success(next ? "水印已开启" : "水印已关闭（仅影响之后的压缩产物）");
	}

	async function compress(f: File, format: "avif" | "webp") {
		busy[f.id] = true;
		try {
			const res = await fetch(`/api/library/${f.id}/compress`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ format, keepOriginal: true })
			});
			const d = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(d.error || "压缩失败");
			files = files.map((x) => (x.id === f.id ? d.file : x));
			toast.success(`${f.filename} · ${d.appliedFormat}，省下 ${formatBytes(d.savedBytes)}（${d.savedPercent}%）`);
			await refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		} finally {
			busy[f.id] = false;
		}
	}

	async function restore(f: File) {
		busy[f.id] = true;
		try {
			const res = await fetch(`/api/library/${f.id}/compress`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ mode: "restore" })
			});
			const d = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(d.error || "还原失败");
			files = files.map((x) => (x.id === f.id ? d.file : x));
			toast.success("已还原为原始版本");
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		} finally {
			busy[f.id] = false;
		}
	}

	async function remove(f: File) {
		if (!(await confirmDelete(`删除「${f.filename}」`, "文件会从 Cloudflare R2 存储中移除，不可恢复。"))) return;
		const res = await fetch(`/api/library/${f.id}`, { method: "DELETE" });
		if (!res.ok) return toast.error("删除失败");
		files = files.filter((x) => x.id !== f.id);
		await refresh();
		toast.success("已删除");
	}

	function onRenameKey(e: KeyboardEvent) {
		if (e.key === "Enter") commitRename();
		if (e.key === "Escape") renameId = null;
	}
</script>

<svelte:head><title>我的附件库 · {data.me.displayName}</title></svelte:head>

<div class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8">
	<!-- 顶部：配额 + 存储状态 -->
	<div class="flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-5">
		<div class="flex flex-wrap items-center gap-3">
			<HardDrive class="size-5 text-primary" />
			<h1 class="font-heading text-xl font-semibold">我的附件库</h1>
			<Badge variant="outline">Lv.{usage.level}</Badge>
			<Badge variant={storageConfigured ? "default" : "destructive"}>
				{storageConfigured ? "Cloudflare R2" : "存储未配置"}
			</Badge>
			<span class="ml-auto text-sm text-muted-foreground">
				{formatBytes(usage.usedBytes)} / {formatBytes(usage.quotaBytes)}
			</span>
		</div>

		<div class="h-2 w-full overflow-hidden rounded-full bg-muted">
			<div class="h-full rounded-full transition-all" class:bg-primary={percent < 80} class:bg-amber-500={percent >= 80} style="width:{percent}%"></div>
		</div>
		<p class="text-xs text-muted-foreground">
			已用 {percent}% · 共 {usage.files} 个文件（其中 {usage.images} 张图片）
			{#if usage.bonusBytes > 0}
				· 含管理员赠送 {formatBytes(usage.bonusBytes)}
			{/if}
			· 容量随经验等级非线性上涨（Lv.1 100M → Lv.6 封顶 1000M）
		</p>

		{#if !storageConfigured}
			<div class="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
				<AlertTriangle class="mt-0.5 size-4 shrink-0 text-amber-500" />
				<div class="space-y-1">
					<p class="font-medium text-amber-600 dark:text-amber-400">附件库需要 Cloudflare R2，目前还没配上</p>
					<p>在项目根目录 .env 里补全以下四项，重启服务后本页即可使用（只配这一处，不用改代码）：</p>
					<pre class="overflow-x-auto rounded bg-muted/60 p-2 text-[11px]">R2_ACCOUNT_ID=…
R2_BUCKET=…
R2_ACCESS_KEY_ID=…
R2_SECRET_ACCESS_KEY=…
# 可选：绑定自定义域名后外链更好看
R2_PUBLIC_URL=https://cdn.example.com</pre>
				</div>
			</div>
		{/if}
	</div>

	<div class="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
		<!-- 目录侧栏 -->
		<aside class="flex flex-col gap-2">
			<div class="flex items-center justify-between px-1">
				<span class="text-xs font-medium text-muted-foreground">目录</span>
				<Button variant="ghost" size="sm" onclick={addFolder}><FolderPlus class="size-4" /></Button>
			</div>
			<Button variant={activeFolder === "root" ? "secondary" : "ghost"} size="sm" class="justify-start" onclick={() => (activeFolder = "root")}>
				全部文件 <span class="ml-auto text-xs opacity-60">{files.length}</span>
			</Button>
			{#each folders as f (f.id)}
				<div class="group flex items-center gap-1">
					<Button
						variant={activeFolder === f.id ? "secondary" : "ghost"}
						size="sm"
						class="min-w-0 flex-1 justify-start"
						onclick={() => (activeFolder = f.id)}
					>
						<FolderIcon class="mr-1.5 size-3.5 shrink-0" />
						<span class="truncate">{f.name}</span>
					</Button>
					<Button variant="ghost" size="icon" class="size-6 shrink-0 opacity-0 group-hover:opacity-100" title="重命名" onclick={() => renameFolderNow(f.id)}><Settings2 class="size-3" /></Button>
					<Button variant="ghost" size="icon" class="size-6 shrink-0 text-destructive opacity-0 group-hover:opacity-100" title="删除" onclick={() => removeFolder(f.id)}><Trash2 class="size-3" /></Button>
				</div>
			{/each}
		</aside>

		<!-- 主区 -->
		<section class="flex min-w-0 flex-col gap-4">
			<!-- 上传 -->
			<!-- 拖入高亮不能写成 class:xxx 指令：带斜杠的类名（bg-primary/5）不是合法指令名，
			     Svelte 会在编译期直接报 Expected token。老老实实整段切字符串最稳。 -->
			<div
				class={dragOver
					? "rounded-xl border border-dashed border-primary bg-primary/5 p-5 text-center transition-colors"
					: "rounded-xl border border-dashed p-5 text-center transition-colors"}
				ondragover={(e) => { e.preventDefault(); dragOver = true; }}
				ondragleave={() => (dragOver = false)}
				ondrop={onDrop}
			>
				<div class="flex flex-wrap items-center justify-center gap-3">
					<Button onclick={() => fileInput?.click()} disabled={uploading || !storageConfigured}>
						{#if uploading}<Loader2 class="mr-1.5 size-4 animate-spin" /> 上传中…{:else}<ImageUp class="mr-1.5 size-4" /> 选择或拖入图片{/if}
					</Button>
					<input bind:this={fileInput} type="file" accept="image/*" multiple class="hidden" onchange={(e) => upload(e.currentTarget.files)} />
					<div class="flex items-center gap-3 text-xs text-muted-foreground">
						<label class="flex items-center gap-1.5"><Switch bind:checked={uploadWatermark} /> 水印</label>
						<label class="flex items-center gap-1.5"><Switch bind:checked={keepOriginal} /> 留原图</label>
						<select bind:value={uploadFormat} class="h-7 rounded-md border border-border/60 bg-background px-2 text-xs">
							<option value="avif">压缩为 AVIF</option>
							<option value="webp">压缩为 WebP</option>
							<option value="original">保留原图</option>
						</select>
					</div>
				</div>
				{#if pendingNames.length}
					<p class="mt-2 truncate text-xs text-muted-foreground">排队中：{pendingNames.join("、")}</p>
				{:else}
					<p class="mt-2 text-xs text-muted-foreground">默认水印开启、压缩为 AVIF；「留原图」会额外存一份原始文件，支持一键还原。</p>
				{/if}
			</div>

			<!-- 工具条 -->
			<div class="flex flex-wrap items-center gap-2">
				<div class="relative min-w-48 flex-1">
					<Search class="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
					<Input bind:value={query} placeholder="搜索文件名或链接" class="h-8 pl-8 text-sm" oninput={() => refresh()} />
				</div>
				<select bind:value={kind} class="h-8 rounded-md border border-border/60 bg-background px-2 text-sm" onchange={() => refresh()}>
					<option value="all">全部</option>
					<option value="image">图片</option>
					<option value="file">其他</option>
				</select>
				<Button variant="ghost" size="icon" class="size-8" title="网格" onclick={() => (view = "grid")}><Grid3x3 class="size-4" /></Button>
				<Button variant="ghost" size="icon" class="size-8" title="列表" onclick={() => (view = "list")}><List class="size-4" /></Button>
				<Button variant="outline" size="sm" onclick={refresh} disabled={loading}><Loader2 class={loading ? "mr-1.5 size-3.5 animate-spin" : "mr-1.5 size-3.5"} /> 刷新</Button>
			</div>

			{#if renameId}
				<div class="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 p-2">
					<Label class="text-xs text-muted-foreground">新文件名</Label>
					<Input bind:value={renameText} class="h-8 text-sm" onkeydown={onRenameKey} />
					<Button size="sm" onclick={commitRename}><Check class="mr-1 size-3.5" /> 保存</Button>
					<Button variant="ghost" size="sm" onclick={() => (renameId = null)}>取消</Button>
				</div>
			{/if}

			{#if visible.length === 0}
				<p class="rounded-xl border border-border/60 p-8 text-center text-sm text-muted-foreground">
					{loading ? "加载中…" : "这里还空着。拖张图进来试试。"}
				</p>
			{:else if view === "grid"}
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
					{#each visible as f (f.id)}
						<div class="group relative overflow-hidden rounded-lg border border-border/60 bg-card">
							{#if f.isImage}
								<img src={f.url} alt={f.filename} class="aspect-square w-full bg-muted object-cover" loading="lazy" />
							{:else}
								<div class="flex aspect-square w-full items-center justify-center bg-muted text-2xl">📄</div>
							{/if}

							{#if f.watermark}
								<span class="absolute left-1.5 top-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white">水印</span>
							{/if}
							{#if f.variant && f.variant !== "original"}
								<span class="absolute right-1.5 top-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white">{f.variant.toUpperCase()}</span>
							{/if}

							<div class="absolute inset-x-0 bottom-0 flex flex-wrap gap-1 bg-gradient-to-t from-black/80 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
								<Button variant="secondary" size="icon" class="size-7" title="复制外链" onclick={() => copyUrl(f)}><Link2 class="size-3.5" /></Button>
								<Button variant="secondary" size="icon" class="size-7" title="复制 Markdown" onclick={() => copyMarkdown(f)}><Copy class="size-3.5" /></Button>
								<Button variant="secondary" size="icon" class="size-7" title="压缩为 AVIF" onclick={() => compress(f, "avif")} disabled={busy[f.id] || !f.isImage}>
									{#if busy[f.id]}<Loader2 class="size-3.5 animate-spin" />{:else}<Wand2 class="size-3.5" />{/if}
								</Button>
								<Button variant="secondary" size="icon" class="size-7" title="移动" onclick={() => moveFile(f)}><MoveRight class="size-3.5" /></Button>
								<Button variant="secondary" size="icon" class="size-7" title="重命名" onclick={() => renameFileNow(f)}><Settings2 class="size-3.5" /></Button>
								<Button variant="destructive" size="icon" class="size-7" title="删除" onclick={() => remove(f)}><Trash2 class="size-3.5" /></Button>
							</div>

							{#if f.hasOriginal}
								<Button
									variant="secondary"
									size="icon"
									class="absolute right-1.5 bottom-1.5 size-6"
									title="还原为原始版本"
									onclick={() => restore(f)}
								><Undo2 class="size-3" /></Button>
							{/if}

							<div class="space-y-0.5 p-2">
								<p class="truncate text-xs font-medium" title={f.filename}>{f.filename}</p>
								<p class="text-[11px] text-muted-foreground">
									{formatBytes(f.bytes)}{f.width ? ` · ${f.width}×${f.height}` : ""}
								</p>
								<button class="text-[11px] text-primary hover:underline" onclick={() => toggleWatermark(f)}>
									{f.watermark ? "关闭水印" : "开启水印"}
								</button>
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<div class="overflow-x-auto rounded-xl border border-border/60">
					<table class="w-full text-sm">
						<thead class="bg-muted/50 text-xs text-muted-foreground">
							<tr><th class="p-2 text-left">名称</th><th class="p-2 text-left">大小</th><th class="p-2 text-left">类型</th><th class="p-2 text-left">水印</th><th class="p-2 text-right">操作</th></tr>
						</thead>
						<tbody>
							{#each visible as f (f.id)}
								<tr class="border-t border-border/40 hover:bg-muted/30">
									<td class="max-w-64 truncate p-2" title={f.filename}>
										{#if f.isImage}<img src={f.url} alt="" class="mr-1.5 inline size-6 rounded object-cover" />{/if}
										{f.filename}
									</td>
									<td class="p-2 text-muted-foreground">{formatBytes(f.bytes)}</td>
									<td class="p-2 text-muted-foreground">{f.variant === "original" ? "原图" : f.variant.toUpperCase()}</td>
									<td class="p-2"><Badge variant={f.watermark ? "default" : "outline"}>{f.watermark ? "开" : "关"}</Badge></td>
									<td class="flex justify-end gap-1 p-2">
										<Button variant="ghost" size="icon" class="size-7" title="复制外链" onclick={() => copyUrl(f)}><Link2 class="size-3.5" /></Button>
										<Button variant="ghost" size="icon" class="size-7" title="复制 Markdown" onclick={() => copyMarkdown(f)}><Copy class="size-3.5" /></Button>
										<Button variant="ghost" size="icon" class="size-7" title="压缩" onclick={() => compress(f, "webp")} disabled={!f.isImage}><Wand2 class="size-3.5" /></Button>
										<Button variant="ghost" size="icon" class="size-7" title="重命名" onclick={() => renameFileNow(f)}><Settings2 class="size-3.5" /></Button>
										<Button variant="ghost" size="icon" class="size-7 text-destructive" title="删除" onclick={() => remove(f)}><Trash2 class="size-3.5" /></Button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}

			<details class="rounded-xl border border-border/60 p-3 text-xs text-muted-foreground">
				<summary class="cursor-pointer font-medium text-foreground">图床用法</summary>
				<ul class="mt-2 space-y-1">
					<li>· 任何图片都可以直接复制外链，贴到评论区、文档、别处都能显示。</li>
					<li>· 图片外链默认走 R2 的公网地址；绑了 <code>R2_PUBLIC_URL</code> 自定义域名就自动换成你的域名。</li>
					<li>· 「一键压缩」用 AVIF/WebP 重压一遍，原图会单独留一份，随时用 ↺ 还原。</li>
					<li>· 别人只能拿到你的文件链接，看不到列表——列表和文件元数据都只属于你自己。</li>
				</ul>
			</details>
		</section>
	</div>
</div>
