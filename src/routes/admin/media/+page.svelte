<script lang="ts">
	import { onMount } from "svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Trash2, Image, Upload, X } from "@lucide/svelte";
	import { toast } from "svelte-sonner";
	import { confirmDelete } from "$lib/components/admin/confirm.svelte";

	let uploads = $state<any[]>([]);
	let loading = $state(true);
	let uploading = $state(false);
	let dragOver = $state(false);

	async function loadUploads() {
		loading = true;
		try {
			uploads = (await (await fetch("/api/media")).json()) as any[];
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
				await fetch("/api/media", { method: "POST", body: formData });
			} catch (e) {
				console.error(e);
			}
			uploading = false;
		}
		await loadUploads();
	}

	async function handleDelete(filename: string) {
		if (!(await confirmDelete("删除文件 " + filename, "文件将从媒体库与磁盘删除，此操作不可恢复。"))) return;
		fetch("/api/media", {
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ filename })
		}).then(() => loadUploads());
	}

	function formatSize(bytes: number): string {
		if (bytes < 1024) return bytes + " B";
		if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
		return (bytes / 1024 / 1024).toFixed(1) + " MB";
	}

	onMount(loadUploads);
</script>

<div class="mb-6">
	<h1 class="text-2xl font-heading font-semibold">媒体库</h1>
	<p class="text-sm text-muted-foreground">上传图片、PDF、视频等媒体文件</p>
</div>

<div class="grid gap-4">
	<div role="region" aria-label="文件上传区" class="rounded-lg border p-6 text-center {dragOver ? 'border-primary bg-primary/5' : 'border-dashed'}" ondragover={(e) => { e.preventDefault(); dragOver = true; }} ondragleave={() => { dragOver = false; }} ondrop={(e) => { e.preventDefault(); dragOver = false; if (e.dataTransfer?.files) handleFileUpload(e.dataTransfer.files); }}>
		<div class="flex flex-col items-center gap-2">
			<Upload class="h-8 w-8 text-muted-foreground" />
			<p class="text-sm">拖拽文件到此处，或</p>
			<label class="inline-flex cursor-pointer items-center gap-2 rounded-md border px-4 py-2 text-sm hover:bg-accent">
				选择文件
				<input type="file" multiple class="hidden" onchange={(e) => { if (e.target.files) handleFileUpload(e.target.files); }} />
			</label>
			{#if uploading}
				<p class="text-xs text-muted-foreground">上传中...</p>
			{/if}
		</div>
	</div>

	{#if loading}
		<p class="text-center text-muted-foreground">加载中...</p>
	{:else if uploads.length === 0}
		<div class="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
			<p>暂无媒体文件</p>
		</div>
	{:else}
		<div class="grid grid-cols-4 gap-3">
			{#each uploads as upload (upload.filename)}
				<div class="group relative overflow-hidden rounded-lg border">
					<div class="aspect-square bg-muted flex items-center justify-center">
						{#if upload.filename.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i)}
							<img src={upload.url} alt={upload.filename} loading="lazy" decoding="async" class="h-full w-full object-cover" />
						{:else}
							<Image class="h-12 w-12 text-muted-foreground" />
						{/if}
					</div>
					<div class="p-2">
						<p class="truncate text-xs font-medium" title={upload.filename}>{upload.filename}</p>
						<p class="text-xs text-muted-foreground">{formatSize(upload.size)} · {upload.date}</p>
				</div>
					<div class="absolute top-1 right-1 hidden group-hover:flex gap-1">
						<a href={upload.url} target="_blank" class="rounded bg-background/80 p-1 hover:bg-background"><Image class="h-3 w-3" /></a>
						<button onclick={() => handleDelete(upload.filename)} class="rounded bg-destructive/80 p-1 text-destructive-foreground hover:bg-destructive"><Trash2 class="h-3 w-3" /></button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>