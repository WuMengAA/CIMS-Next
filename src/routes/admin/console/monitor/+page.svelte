<script lang="ts">
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "$lib/components/ui/card/index.js";
	import { Select, SelectContent, SelectItem, SelectTrigger } from "$lib/components/ui/select/index.js";
	import { SlidersHorizontal, Save, RefreshCw } from "@lucide/svelte";

	// 监控设置（Svelte 版 · 2026-09-26）：截图/录像/远控编码参数统一管理。
	let screenshot_webp_quality = $state(75);
	let screenshot_max_width = $state(1280);
	let monitor_interval_sec = $state(0);
	let monitor_retention_days = $state(7);
	let video_codec = $state("vp9");
	let video_bitrate_kbps = $state(600);
	let video_fps = $state(30);
	let video_resolution = $state("1080p");
	let p2p_ice_override = $state("");
	let saving = $state(false);

	onMount(async () => {
		try {
			const r = await fetch("/api/console/control/monitor-config");
			const j = await r.json();
			const c = j.config ?? {};
			screenshot_webp_quality = Number(c.screenshot_webp_quality ?? 75);
			screenshot_max_width = Number(c.screenshot_max_width ?? 1280);
			monitor_interval_sec = Number(c.monitor_interval_sec ?? 0);
			monitor_retention_days = Number(c.monitor_retention_days ?? 7);
			video_codec = String(c.video_codec ?? "vp9");
			video_bitrate_kbps = Number(c.video_bitrate_kbps ?? 600);
			video_fps = Number(c.video_fps ?? 30);
			video_resolution = String(c.video_resolution ?? "1080p");
			p2p_ice_override = String(c.p2p_ice_override ?? "");
		} catch {
			toast.error("加载监控配置失败");
		}
	});

	function collect() {
		return {
			screenshot_webp_quality, screenshot_max_width, monitor_interval_sec,
			monitor_retention_days, video_codec, video_bitrate_kbps, video_fps,
			video_resolution, p2p_ice_override
		};
	}

	async function save() {
		saving = true;
		try {
			const r = await fetch("/api/console/control/monitor-config", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(collect())
			});
			const j = await r.json();
			if (!r.ok) { toast.error(j.error ?? "保存失败"); return; }
			toast.success("监控参数已保存（设备端下次操作生效）");
		} catch {
			toast.error("保存失败");
		} finally {
			saving = false;
		}
	}

	async function reset() {
		try {
			const r = await fetch("/api/console/control/monitor-config");
			const j = await r.json();
			const c = j.config ?? {};
			screenshot_webp_quality = Number(c.screenshot_webp_quality ?? 75);
			screenshot_max_width = Number(c.screenshot_max_width ?? 1280);
			monitor_interval_sec = Number(c.monitor_interval_sec ?? 0);
			monitor_retention_days = Number(c.monitor_retention_days ?? 7);
			video_codec = String(c.video_codec ?? "vp9");
			video_bitrate_kbps = Number(c.video_bitrate_kbps ?? 600);
			video_fps = Number(c.video_fps ?? 30);
			video_resolution = String(c.video_resolution ?? "1080p");
			p2p_ice_override = String(c.p2p_ice_override ?? "");
			toast.success("已恢复默认参数");
		} catch {
			toast.error("恢复失败");
		}
	}
</script>

<div class="space-y-6">
	<div>
		<h2 class="text-xl font-bold flex items-center gap-2"><SlidersHorizontal class="size-5" /> 监控与远控参数</h2>
		<p class="text-sm text-muted-foreground mt-1">全局统一 · 经设备密钥拉取 · 对所有设备生效</p>
	</div>

	<Card>
		<CardHeader>
			<CardTitle>采集与编码</CardTitle>
			<CardDescription>截图上传体积、远控画质与带宽的平衡点</CardDescription>
		</CardHeader>
		<CardContent class="space-y-4">
			<div class="grid gap-1.5">
				<Label>截图压缩质量</Label>
				<Input bind:value={screenshot_webp_quality} type="number" />
				<p class="text-xs text-muted-foreground">WebP 质量 0-100，越低越小（默认 75，目标 ~100KB）</p>
			</div>
			<div class="grid gap-1.5">
				<Label>截图最大宽度</Label>
				<Input bind:value={screenshot_max_width} type="number" />
				<p class="text-xs text-muted-foreground">像素，超宽自动缩放（默认 1280）</p>
			</div>
			<div class="grid gap-1.5">
				<Label>定时截图间隔</Label>
				<Input bind:value={monitor_interval_sec} type="number" />
				<p class="text-xs text-muted-foreground">秒，0=关闭定时截图</p>
			</div>
			<div class="grid gap-1.5">
				<Label>截图保留天数</Label>
				<Input bind:value={monitor_retention_days} type="number" />
				<p class="text-xs text-muted-foreground">超过自动清理（默认 7 天）</p>
			</div>
			<div class="grid gap-1.5">
				<Label>远控编码</Label>
				<Select bind:value={video_codec}>
					<SelectTrigger>{video_codec}</SelectTrigger>
					<SelectContent>
						<SelectItem value="vp9">vp9（推荐，全兼容≈H265）</SelectItem>
						<SelectItem value="vp8">vp8</SelectItem>
						<SelectItem value="h264">h264</SelectItem>
						<SelectItem value="hevc">hevc（仅 Safari）</SelectItem>
					</SelectContent>
				</Select>
				<p class="text-xs text-muted-foreground">VP9（推荐）：画质好、浏览器全兼容；HEVC：仅苹果浏览器支持</p>
			</div>
			<div class="grid gap-1.5">
				<Label>远控码率</Label>
				<Input bind:value={video_bitrate_kbps} type="number" />
				<p class="text-xs text-muted-foreground">kbps，低码率省带宽（默认 600）</p>
			</div>
			<div class="grid gap-1.5">
				<Label>远控帧率</Label>
				<Input bind:value={video_fps} type="number" />
				<p class="text-xs text-muted-foreground">帧/秒（默认 30）</p>
			</div>
			<div class="grid gap-1.5">
				<Label>远控分辨率</Label>
				<Select bind:value={video_resolution}>
					<SelectTrigger>{video_resolution}</SelectTrigger>
					<SelectContent>
						<SelectItem value="1080p">1080p</SelectItem>
						<SelectItem value="720p">720p</SelectItem>
						<SelectItem value="480p">480p</SelectItem>
					</SelectContent>
				</Select>
				<p class="text-xs text-muted-foreground">默认 1080p</p>
			</div>
			<div class="grid gap-1.5">
				<Label>ICE 服务器覆盖</Label>
				<Input bind:value={p2p_ice_override} type="text" placeholder="留空=仅局域网直连；填 STUN/TURN JSON 数组可跨网" />
				<p class="text-xs text-muted-foreground">留空=仅局域网直连；填 STUN/TURN JSON 数组可跨网</p>
			</div>
		</CardContent>
	</Card>

	<div class="flex gap-2">
		<Button onclick={save} disabled={saving}>
			{#if saving}<RefreshCw class="size-4 animate-spin" />{:else}<Save class="size-4" />{/if}
			保存参数
		</Button>
		<Button variant="outline" onclick={reset}>恢复默认</Button>
	</div>
</div>
