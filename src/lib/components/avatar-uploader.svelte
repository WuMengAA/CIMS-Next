<script lang="ts">
	/**
	 * 头像上传器。
	 *
	 * 交互上刻意做成「选完立刻预览，点保存才真的传」：
	 * 一次性把文件读成 dataURL 预览，上传失败还能原地重试，不会因为服务端一个小抖动
	 * 就丢掉用户刚选的图。
	 *
	 * 上传走 /api/account/avatar（服务端压缩 + 存 R2 + 回写 users.avatar），
	 * 成功后回调让父组件把新 URL 回填进资料表单——避免"传完了但没保存资料"这种经典坑。
	 */
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { Switch } from "$lib/components/ui/switch/index.js";
	import { toast } from "svelte-sonner";
	import { ImageUp, Loader2, Trash2 } from "@lucide/svelte";

	interface Props {
		/** 当前头像 URL（可为空 → 显示首字头像） */
		value?: string;
		/** 上传完成且资料保存后回调；父组件据此刷新。 */
		onchange?: (url: string) => void;
		compact?: boolean;
	}
	let { value = "", onchange, compact = false }: Props = $props();

	let fileInput: HTMLInputElement | null = $state(null);
	let preview = $state("");
	let uploading = $state(false);
	let useWatermark = $state(true);
	let useWebp = $state(true);
	let errorMsg = $state("");

	const display = $derived(preview || value || "");

	function pick() {
		fileInput?.click();
	}

	function onFileChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const f = input.files?.[0];
		errorMsg = "";
		if (!f) return;
		if (f.size > 8 * 1024 * 1024) {
			errorMsg = "图片不能超过 8 MB";
			toast.error(errorMsg);
			input.value = "";
			return;
		}
		const reader = new FileReader();
		reader.onload = () => {
			preview = String(reader.result ?? "");
		};
		reader.onerror = () => {
			errorMsg = "读取图片失败";
		};
		reader.readAsDataURL(f);
		input.value = ""; // 允许连着选同一个文件重新触发 change
	}

	async function upload() {
		if (!preview.startsWith("data:")) {
			errorMsg = "请先选择图片";
			return;
		}
		uploading = true;
		errorMsg = "";
		try {
			// dataURL → Blob 再塞进 FormData，让服务端按普通文件上传处理
			const res = await fetch(preview);
			const blob = await res.blob();
			const form = new FormData();
			form.set("file", blob, "avatar.jpg");
			form.set("watermark", useWatermark ? "on" : "off");
			form.set("format", useWebp ? "webp" : "avif");

			const r = await fetch("/api/account/avatar", { method: "POST", body: form });
			const d = await r.json().catch(() => ({}));
			if (!r.ok || !d.ok) {
				throw new Error(d.error || "上传失败");
			}
			preview = d.avatar || "";
			onchange?.(d.avatar as string);
			toast.success("头像已上传，记得点「保存资料」生效");
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : String(e);
			toast.error(errorMsg);
		} finally {
			uploading = false;
		}
	}

	function removePreview() {
		preview = "";
		onchange?.("");
	}
</script>

<div class="flex flex-col gap-3 {compact ? '' : 'sm:flex-row sm:items-start'}">
	<!-- 预览：有图显示图，没图退回首字头像（跟服务端默认行为一致，别让空头像长歪） -->
	<div
		class="relative size-16 shrink-0 overflow-hidden rounded-full border border-border/60 bg-muted sm:size-20"
		aria-label="头像预览"
	>
		{#if display}
			<img src={display} alt="头像预览" class="size-full object-cover" />
		{:else}
			<div class="flex size-full items-center justify-center text-lg font-medium text-muted-foreground">?</div>
		{/if}
		{#if uploading}
			<div class="absolute inset-0 flex items-center justify-center bg-background/70">
				<Loader2 class="size-5 animate-spin" />
			</div>
		{/if}
	</div>

	<div class="flex min-w-0 flex-1 flex-col gap-2">
		<div class="flex flex-wrap items-center gap-2">
			<Button variant="outline" size="sm" onclick={pick} disabled={uploading}>
				<ImageUp class="mr-1.5 h-4 w-4" /> 选择图片
			</Button>
			{#if preview}
				<Button variant="ghost" size="sm" onclick={upload} disabled={uploading}>
					{#if uploading}<Loader2 class="mr-1.5 h-4 w-4 animate-spin" /> 上传中{:else}上传到服务器{/if}
				</Button>
				<Button variant="ghost" size="sm" onclick={removePreview} disabled={uploading}>
					<Trash2 class="mr-1.5 h-4 w-4" /> 撤销
				</Button>
			{/if}
			<input
				bind:this={fileInput}
				type="file"
				accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
				class="hidden"
				onchange={onFileChange}
			/>
		</div>

		<div class="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
			<label class="flex items-center gap-1.5">
				<Switch bind:checked={useWatermark} /> 加水印
			</label>
			<label class="flex items-center gap-1.5">
				<Switch bind:checked={useWebp} /> WebP 压缩
			</label>
			<span>上传后自动压缩到 1024px 以内（原图另存）</span>
		</div>

		{#if errorMsg}
			<p class="text-xs text-destructive">{errorMsg}</p>
		{/if}

		<!-- 手填 URL 保留为"高级"选项：上传失败或想用别处的图时还有退路 -->
		<div class="grid gap-1.5">
			<Label class="text-xs text-muted-foreground">或直接填图片 URL（可选）</Label>
			<Input bind:value placeholder="https://…" class="h-8 text-xs" />
		</div>
	</div>
</div>
