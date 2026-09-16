<script lang="ts">
	import { onMount } from "svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Trash2, Image as ImageIcon, FileText, Upload, X, Search, Copy, Check, FileArchive, FileAudio, FileVideo, FileSpreadsheet, FileCode2, File as FileIcon, Loader2, RefreshCw } from "@lucide/svelte";
	import { toast } from "svelte-sonner";
	import { confirmDelete } from "$lib/components/admin/confirm.svelte";

	interface UploadItem { filename: string; url: string; size: number; date: string; kind: string }

	let uploads = $state<UploadItem[]>([]);
	let loading = $state(true);
	let uploading = $state(false);
	let dragOver = $state(false);
	let query = $state("");
	let copied = $state("");
	// 类型筛选：all / image / doc / audio / video / archive / other
	let filter = $state("all");

	const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "ico"];
	const DOC_EXTS = ["pdf", "txt", "md", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "json"];
	const AUDIO_EXTS = ["mp3", "wav", "ogg", "flac", "m4a"];
	const VIDEO_EXTS = ["mp4", "webm", "mov", "avi", "mkv"];
	const ARCHIVE_EXTS = ["zip", "rar", "7z", "tar", "gz", "apk"];

	function kindOf(k: string): string {
		if (IMAGE_EXTS.includes(k)) return "image";
		if (DOC_EXTS.includes(k)) return "doc";
		if (AUDIO_EXTS.includes(k)) return "audio";
		if (VIDEO_EXTS.includes(k)) return "video";
		if (ARCHIVE_EXTS.includes(k)) return "archive";
		return "other";
	}
	function iconFor(k: string): any {
		const t = kindOf(k);
		if (t === "image") return ImageIcon;
		if (t === "doc") return FileText;
		if (t === "audio") return FileAudio;
		if (t === "video") return FileVideo;
		if (t === "archive") return FileArchive;
		if (k === "json" || k === "csv") return FileCode2;
		if (k === "xls" || k === "xlsx" || k === "csv") return FileSpreadsheet;
		return FileIcon;
	}

	const filtered = $derived.by(() => {
		let list = uploads;
		if (filter !== "all") list = list.filter((u) => kindOf(u.kind) === filter);
		if (query.trim()) {
			const q = query.trim().toLowerCase();
			list = list.filter((u) => u.filename.toLowerCase().includes(q));
		}
		return list;
	});

	const FILTERS = [
		{ id: "all", label: "全部" },
		{ id: "image", label: "图片" },
		{ id: "doc", label: "文档" },
		{ id: "audio", label: "音频" },
		{ id: "video", label: "视频" },
		{ id: "archive", label: "压缩/安装包" },
		{ id: "other", label: "其它" }
	];

	async function loadUploads() {
		loading = true;
		try {
			const res = await fetch("/api/media");
			if (res.status === 401) {
				uploading = false; loading = false;
				return;
			}
			uploads = (await res.json()) as UploadItem[];
		} catch (e) {
			console.error(e);
		}
		loading = false;
	}

	async function handleFileUpload(files: FileList | File[]) {
		for (const file of Array.from(files)) {
			uploading = true;
			try {
				const formData = new FormData();
				formData.append("file", file);
				const res = await fetch("/api/media", { method: "POST", body: formData });
				const d = await res.json().catch(() => ({}));
				if (!res.ok) toast.error(d.error || `「${file.name}」上传失败`);
			} catch (e) {
				console.error(e);
				toast.error(`「${file.name}」上传失败`);
			}
		}
		uploading = false;
		await loadUploads();
	}

	async function handleDelete(filename: string) {
		if (!(await confirmDelete("删除文件 " + filename, "文件将从附件库与磁盘删除，此操作不可恢复。"))) return;
		fetch("/api/media", {
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ filename })
		}).then(() => loadUploads());
	}

	async function copyLink(url: string) {
		try {
			await navigator.clipboard.writeText(location.origin + url);
			copied = url;
			setTimeout(() => { copied = ""; }, 1500);
		} catch {
			toast.error("复制失败，请手动复制地址");
		}
	}

	function formatSize(bytes: number): string {
		if (bytes < 1024) return bytes + " B";
		if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
		return (bytes / 1024 / 1024).toFixed(1) + " MB";
	}

	onMount(loadUploads);
</script>

<div class="mb-6">
	<h1 class="text-2xl font-heading font-semibold">附件库</h1>
	<p class="text-sm text-muted-foreground">上传图片、文档、压缩包、音视频等任意文件，支持复制直链（上传 / 保存 / 读取 / 删除全链路）</p>
</div>

<div class="grid gap-4">
	<div role="region" aria-label="文件上传区" class="rounded-lg border p-6 text-center {dragOver ? 'border-primary bg-primary/5' : 'border-dashed'}" ondragover={(e) => { e.preventDefault(); dragOver = true; }} ondragleave={() => { dragOver = false; }} ondrop={(e) => { e.preventDefault(); dragOver = false; if (e.dataTransfer?.files) handleFileUpload(e.dataTransfer.files); }}>
		<div class="flex flex-col items-center gap-2">
			<Upload class="h-8 w-8 text-muted-foreground" />
			<p class="text-sm">拖拽文件到此处，或</p>
			<label class="inline-flex cursor-pointer items-center gap-2 rounded-md border px-4 py-2 text-sm hover:bg-accent">
				选择文件
				<input type="file" multiple class="hidden" onchange={(e: Event) => { const t = e.target as HTMLInputElement; if (t.files) handleFileUpload(t.files); }} />
			</label>
			{#if uploading}
				<p class="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 class="size-3 animate-spin" /> 上传中...</p>
			{/if}
			<p class="text-xs text-muted-foreground">支持常见图片 / 文档 / 音频 / 视频 / 压缩包 / APK，单文件 ≤ 100MB</p>
		</div>
	</div>

	<!-- 搜索 + 类型筛选 -->
	<div class="flex flex-wrap items-center gap-2">
		<div class="relative min-w-0 flex-1 sm:max-w-xs">
			<Search class="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
			<Input bind:value={query} placeholder="搜索文件名…" class="h-9 pl-8" />
		</div>
		<div class="flex flex-wrap gap-1">
			{#each FILTERS as f (f.id)}
				<button
					onclick={() => (filter = f.id)}
					class="rounded-md px-2.5 py-1 text-xs transition-colors {filter === f.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'}"
				>{f.label}</button>
			{/each}
		</div>
		<button onclick={loadUploads} class="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground" title="刷新列表">
			<RefreshCw class="size-3" /> 刷新
		</button>
	</div>

	{#if loading}
		<p class="inline-flex items-center gap-2 text-center text-muted-foreground"><Loader2 class="size-4 animate-spin" /> 加载中...</p>
	{:else if uploads.length === 0}
		<div class="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
			<p>附件库暂无文件</p>
		</div>
	{:else if filtered.length === 0}
		<div class="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
			<p>没有匹配「{query || FILTERS.find((f) => f.id === filter)?.label}」的文件</p>
		</div>
	{:else}
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
			{#each filtered as upload (upload.filename)}
				{@const FileIcon_ = iconFor(upload.kind)}
				<div class="group relative overflow-hidden rounded-lg border">
					<div class="flex h-28 items-center justify-center bg-muted">
						{#if kindOf(upload.kind) === "image"}
							<img src={upload.url} alt={upload.filename} loading="lazy" decoding="async" class="h-full w-full object-cover" />
						{:else}
							<div class="flex flex-col items-center gap-1 text-muted-foreground">
								<FileIcon_ class="size-10" />
								<span class="rounded bg-background/80 px-1.5 py-0.5 text-[10px] font-medium uppercase">{upload.kind || "file"}</span>
							</div>
						{/if}
					</div>
					<div class="p-2">
						<p class="truncate text-xs font-medium" title={upload.filename}>{upload.filename}</p>
						<p class="text-xs text-muted-foreground">{formatSize(upload.size)} · {upload.date}</p>
					</div>
					<div class="absolute inset-x-0 top-1 flex justify-end gap-1 px-1 opacity-0 transition-opacity group-hover:opacity-100">
						{#if copied === upload.url}
							<span class="inline-flex items-center gap-1 rounded bg-background/90 px-1.5 py-1 text-[10px] text-primary"><Check class="h-3 w-3" /> 已复制</span>
						{:else}
							<button onclick={() => copyLink(upload.url)} title="复制链接" class="rounded bg-background/90 p-1 text-muted-foreground hover:text-foreground"><Copy class="h-3 w-3" /></button>
						{/if}
						<a href={upload.url} target="_blank" title="新窗口打开" class="rounded bg-background/90 p-1 text-muted-foreground hover:text-foreground"><FileIcon class="h-3 w-3" /></a>
						<button onclick={() => handleDelete(upload.filename)} title="删除" class="rounded bg-destructive/90 p-1 text-destructive-foreground hover:bg-destructive"><Trash2 class="h-3 w-3" /></button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>