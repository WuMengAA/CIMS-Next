<script lang="ts">
	import PageHero from "$lib/components/page-hero.svelte";
	import { Card } from "$lib/components/ui/card/index.js";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { ImagePlus, Download, RotateCw, Wand2, Upload } from "@lucide/svelte";

	let fileInput: HTMLInputElement;
	let canvas: HTMLCanvasElement;
	let img: HTMLImageElement | null = null;
	let fileName = $state("");
	let filter = $state("none");
	let scalePct = $state(100);
	let rotation = $state(0);
	let format = $state("image/png");
	let status = $state("上传一张图片，或拖拽到虚线区域。所有处理都在本地浏览器完成。");

	// 生成器状态
	let genA = $state("#6366f1");
	let genB = $state("#ec4899");
	let genDir = $state("to right");

	function onFile(f: File | undefined | null) {
		if (!f || !f.type.startsWith("image/")) {
			status = "请选择图片文件";
			return;
		}
		const reader = new FileReader();
		reader.onload = () => {
			const i = new Image();
			i.onload = () => {
				img = i;
				fileName = f.name;
				status = `已载入 ${f.name}（${i.naturalWidth}×${i.naturalHeight}）`;
				requestAnimationFrame(draw);
			};
			i.src = String(reader.result);
		};
		reader.readAsDataURL(f);
	}

	function draw() {
		if (!canvas || !img) return;
		const ctx = canvas.getContext("2d")!;
		const scale = scalePct / 100;
		const rad = (rotation * Math.PI) / 180;
		const w = img.naturalWidth * scale;
		const h = img.naturalHeight * scale;
		// 旋转后画布尺寸
		const outW = rotation % 180 === 0 ? w : h;
		const outH = rotation % 180 === 0 ? h : w;
		canvas.width = Math.max(1, Math.round(outW));
		canvas.height = Math.max(1, Math.round(outH));
		ctx.save();
		ctx.translate(canvas.width / 2, canvas.height / 2);
		ctx.rotate(rad);
		ctx.filter =
			filter === "grayscale" ? "grayscale(1)"
			: filter === "sepia" ? "sepia(1)"
			: filter === "invert" ? "invert(1)"
			: filter === "blur" ? "blur(3px)"
			: "none";
		ctx.drawImage(img, -w / 2, -h / 2, w, h);
		ctx.restore();
	}

	function exportImage() {
		if (!canvas) return;
		canvas.toBlob((blob) => {
			if (!blob) return;
			const a = document.createElement("a");
			const ext = format === "image/jpeg" ? "jpg" : format === "image/webp" ? "webp" : "png";
			a.href = URL.createObjectURL(blob);
			a.download = `image-${Date.now()}.${ext}`;
			a.click();
			URL.revokeObjectURL(a.href);
		}, format, 0.92);
	}

	// ── 生成器 ───────────────────────────────────────────────
	function generate() {
		if (!canvas) return;
		const ctx = canvas.getContext("2d")!;
		canvas.width = 1600;
		canvas.height = 900;
		const grad =
			genDir === "to right" ? ctx.createLinearGradient(0, 0, 1600, 0)
			: genDir === "to bottom" ? ctx.createLinearGradient(0, 0, 0, 900)
			: ctx.createLinearGradient(0, 0, 1600, 900);
		grad.addColorStop(0, genA);
		grad.addColorStop(1, genB);
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, 1600, 900);
		status = "已生成 1600×900 渐变壁纸，可直接导出。";
	}
</script>

<svelte:head>
	<title>图片工具 | Stelarith</title>
</svelte:head>

<PageHero icon={ImagePlus} title="图片工具" desc="缩放、旋转、滤镜、格式转换与渐变壁纸生成，全部在本地浏览器完成。" />

<div class="mx-auto grid max-w-5xl gap-5 px-4 py-8 md:grid-cols-[1fr_300px]">
	<!-- 画布区 -->
	<Card class="p-4">
		<canvas
			bind:this={canvas}
			class="max-h-[420px] w-full rounded-lg border border-border bg-checker bg-muted/30"
		></canvas>
		{#if !img}
			<div
				class="mt-2 flex h-28 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-muted-foreground"
				ondragover={(e) => e.preventDefault()}
				ondrop={(e) => { e.preventDefault(); onFile(e.dataTransfer?.files?.[0]); }}
			>
				<Upload class="size-6" />
				<p class="text-sm">拖拽图片到这里，或</p>
				<Button variant="outline" size="sm" onclick={() => fileInput.click()}>选择图片</Button>
			</div>
		{/if}
		<input type="file" accept="image/*" bind:this={fileInput} class="hidden" onchange={(e) => onFile(e.currentTarget.files?.[0])} />
		<p class="mt-3 text-xs text-muted-foreground">{status}</p>
	</Card>

	<!-- 控制区 -->
	<Card class="flex flex-col gap-4 p-4">
		<div class="grid gap-1.5">
			<label class="text-xs font-medium text-muted-foreground">缩放 {scalePct}%</label>
			<input type="range" min="10" max="300" step="5" bind:value={scalePct} class="w-full accent-primary" oninput={draw} />
		</div>
		<div class="grid gap-1.5">
			<label class="text-xs font-medium text-muted-foreground">旋转</label>
			<div class="flex gap-2">
				{#each [0, 90, 180, 270] as deg (deg)}
					<Button variant={rotation === deg ? "default" : "outline"} size="sm" class="flex-1" onclick={() => { rotation = deg; draw(); }}>
						{deg}°
					</Button>
				{/each}
			</div>
		</div>
		<div class="grid gap-1.5">
			<label class="text-xs font-medium text-muted-foreground">滤镜</label>
			<select bind:value={filter} onchange={draw} class="h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-primary/60">
				<option value="none">无</option>
				<option value="grayscale">灰度</option>
				<option value="sepia">复古</option>
				<option value="invert">反色</option>
				<option value="blur">模糊</option>
			</select>
		</div>
		<div class="grid gap-1.5">
			<label class="text-xs font-medium text-muted-foreground">导出格式</label>
			<select bind:value={format} class="h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-primary/60">
				<option value="image/png">PNG（无损）</option>
				<option value="image/jpeg">JPEG（压缩）</option>
				<option value="image/webp">WebP（现代）</option>
			</select>
		</div>
		<Button onclick={exportImage} disabled={!img && !canvas?.width} class="gap-2">
			<Download class="size-4" />导出图片
		</Button>

		<div class="my-1 border-t border-border"></div>

		<!-- 生成器 -->
		<h4 class="flex items-center gap-2 text-sm font-semibold"><Wand2 class="size-4 text-primary" />渐变壁纸生成</h4>
		<div class="flex items-center gap-2">
			<input type="color" bind:value={genA} class="size-10 cursor-pointer rounded-md border border-border" />
			<input type="color" bind:value={genB} class="size-10 cursor-pointer rounded-md border border-border" />
		</div>
		<select bind:value={genDir} class="h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-primary/60">
			<option value="to right">水平渐变</option>
			<option value="to bottom">垂直渐变</option>
			<option value="diagonal">对角渐变</option>
		</select>
		<Button variant="secondary" onclick={generate} class="gap-2">
			<Wand2 class="size-4" />生成 1600×900 壁纸
		</Button>
	</Card>
</div>
