<script lang="ts">
	import { onMount } from "svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Select } from "$lib/components/ui/select/index.js";
	import { Switch } from "$lib/components/ui/switch/index.js";
	import { Slider } from "$lib/components/ui/slider/index.js";
	import { Save, Plus, Trash2, Download, Wand2, LayoutGrid } from "@lucide/svelte";
	import BgEffects from "$lib/components/bg-effects.svelte";
	import { FEATURE_ICON_OPTIONS } from "$lib/feature-icons.js";

	let title = $state("");
	let description = $state("");
	let socials = $state<{ name: string; url: string }[]>([]);
	let features = $state<{ title: string; description: string; icon: string }[]>([]);
	let saving = $state(false);
	let saved = $state(false);
	let backupPass = $state("");
	let bgStyle = $state("aurora");
	let bgColor1 = $state("#cc785c");
	let bgColor2 = $state("#8b5cf6");
	let bgColor3 = $state("#0ea5e9");
	let bgIntensity = $state(0.5);
	let bgSpeed = $state(1);
	let bgParticles = $state(true);
	let backupMsg = $state("");
	let intensityArr = $state<number[]>([bgIntensity]);
	let speedArr = $state<number[]>([bgSpeed]);
	$effect(() => { bgIntensity = intensityArr[0] ?? bgIntensity; });
	$effect(() => { bgSpeed = speedArr[0] ?? bgSpeed; });

	async function load() {
		try {
			const res = await fetch("/api/settings");
			if (res.ok) {
				const s = await res.json();
				title = s.title || "";
				description = s.description || "";
				socials = s.socials || [];
				features = (s.features || []).map((f: { title?: string; description?: string; icon?: string }) => ({
					title: f.title || "",
					description: f.description || "",
					icon: f.icon || "sparkles"
				}));
				const bg = s.background || {};
				bgStyle = bg.style || "aurora"; bgColor1 = bg.color1 || "#cc785c"; bgColor2 = bg.color2 || "#8b5cf6"; bgColor3 = bg.color3 || "#0ea5e9";
				bgIntensity = bg.intensity ?? 0.5; bgSpeed = bg.speed ?? 1; bgParticles = bg.particles ?? true;
			intensityArr = [bg.intensity ?? 0.5]; speedArr = [bg.speed ?? 1];
			}
		} catch (e) { console.error(e); }
	}

	function addSocial() {
		socials = [...socials, { name: "", url: "" }];
	}

	function removeSocial(index: number) {
		socials = socials.filter((_, i) => i !== index);
	}

	function addFeature() {
		features = [...features, { title: "", description: "", icon: "sparkles" }];
	}

	function removeFeature(index: number) {
		features = features.filter((_, i) => i !== index);
	}

	async function save() {
		saving = true;
		saved = false;
		try {
			await fetch("/api/settings", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title, description, socials, features, background: { style: bgStyle, color1: bgColor1, color2: bgColor2, color3: bgColor3, intensity: intensityArr[0], speed: speedArr[0], particles: bgParticles } })
			});
			saved = true;
			setTimeout(() => { saved = false; }, 3000);
		} catch (e) { console.error(e); }
		saving = false;
	}

	async function exportBackup() {
		try {
			const headers = {};
			if (backupPass.trim()) headers["x-encrypt-pass"] = backupPass.trim();
			const res = await fetch("/api/backup", { headers });
			if (!res.ok) { backupMsg = "导出失败，请重试"; return; }
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = "stelarith-backup.json";
			a.click();
			URL.revokeObjectURL(url);
			backupMsg = backupPass.trim() ? "已加密导出" : "备份已导出";
		} catch {
			backupMsg = "导出失败，请重试";
		}
	}

	onMount(load);
</script>

<div class="mb-6">
	<h1 class="text-2xl font-heading font-semibold">站点设置</h1>
	<p class="text-sm text-muted-foreground">配置站点标题、描述与社交链接</p>
</div>

<div class="max-w-2xl space-y-6">
	<div class="grid gap-2">
		<Label>站点标题</Label>
		<Input bind:value={title} placeholder="Stelarith" />
	</div>

	<div class="grid gap-2">
		<Label>站点描述</Label>
		<Input bind:value={description} placeholder="一个收纳创作、记录与兴趣的个人互联网空间。" />
	</div>

	<div class="grid gap-3">
		<div class="flex items-center justify-between">
			<Label>社交链接</Label>
			<Button variant="outline" size="sm" onclick={addSocial}>
				<Plus class="h-4 w-4 mr-1" />
				添加
			</Button>
		</div>
		{#each socials as social, i (i)}
			<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
				<Input bind:value={social.name} placeholder="名称（GitHub）" class="w-full sm:w-32" />
				<Input bind:value={social.url} placeholder="https://..." class="w-full sm:flex-1" />
				<Button variant="ghost" size="icon" class="h-9 w-9 shrink-0 text-destructive hover:text-destructive sm:ml-auto" onclick={() => removeSocial(i)}>
					<Trash2 class="h-4 w-4" />
				</Button>
			</div>
		{/each}
	</div>


	<hr class="my-2 border-border/40" />

	<div class="flex flex-col gap-3">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-2">
				<LayoutGrid class="size-4 text-primary" />
				<Label>首页特性卡</Label>
			</div>
			<Button variant="outline" size="sm" onclick={addFeature}>
				<Plus class="h-4 w-4 mr-1" />
				添加
			</Button>
		</div>
		<p class="text-sm text-muted-foreground">展示在首页「特性」区，建议 3 条，每条含标题、描述与图标。</p>
		{#each features as feature, i (i)}
			<div class="flex flex-col gap-2 rounded-lg border border-border/60 p-3">
			<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
				<Input bind:value={feature.title} placeholder="标题（如：静态导出）" class="w-full sm:flex-1" />
				<Select.Root type="single" bind:value={feature.icon}>
					<Select.Trigger class="w-full sm:w-32" aria-label="图标">
							{FEATURE_ICON_OPTIONS.find((o) => o.value === feature.icon)?.label ?? "图标"}
						</Select.Trigger>
						<Select.Content>
							{#each FEATURE_ICON_OPTIONS as opt (opt.value)}
								<Select.Item value={opt.value} label={opt.label} />
							{/each}
						</Select.Content>
					</Select.Root>
					<Button
						variant="ghost"
						size="icon"
						class="h-9 w-9 shrink-0 text-destructive hover:text-destructive sm:ml-auto"
						onclick={() => removeFeature(i)}
					>
						<Trash2 class="h-4 w-4" />
					</Button>
				</div>
				<Input bind:value={feature.description} placeholder="描述文案" />
			</div>
		{/each}
	</div>

	<hr class="my-2 border-border/40" />

	<div class="flex flex-col gap-3">
		<h2 class="flex items-center gap-2 font-heading text-lg font-medium"><Wand2 class="size-4 text-primary" /> 动画背景</h2>
		<p class="text-sm text-muted-foreground">页面背景动画（极光/网格光/粒子/彩虹），实时预览，保存后全局生效。</p>
		<!-- Live preview -->
		<div class="relative h-36 overflow-hidden rounded-lg border border-border/60">
			<BgEffects config={{ style: bgStyle, color1: bgColor1, color2: bgColor2, color3: bgColor3, intensity: intensityArr[0], speed: speedArr[0], particles: bgParticles }} />
			<span class="absolute bottom-2 left-2 rounded bg-black/50 px-2 py-0.5 text-[10px] text-white/80">预览</span>
		</div>
		<div class="grid gap-3 sm:grid-cols-2">
			<div class="grid gap-1.5">
				<Label>风格</Label>
				<Select.Root type="single" bind:value={bgStyle}>
					<Select.Trigger class="w-full">
						{({ aurora: "极光流动（默认）", grid: "网格光", particles: "粒子星空", rainbow: "彩虹渐变", none: "无背景动画" })[bgStyle] ?? bgStyle}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="aurora" label="极光流动（默认）" />
						<Select.Item value="grid" label="网格光" />
						<Select.Item value="particles" label="粒子星空" />
						<Select.Item value="rainbow" label="彩虹渐变" />
						<Select.Item value="none" label="无背景动画" />
					</Select.Content>
				</Select.Root>
			</div>
			<div class="grid gap-1.5">
				<Label>粒子层（极光时可用）</Label>
				<div class="flex items-center gap-2 pt-2 text-sm"><Switch bind:checked={bgParticles} /> 显示粒子</div>
			</div>
		</div>
		<div class="grid grid-cols-3 gap-3">
			<div class="grid gap-1.5"><Label>主色</Label><input type="color" bind:value={bgColor1} class="h-9 w-full cursor-pointer rounded-md border border-border/60 bg-transparent" /></div>
			<div class="grid gap-1.5"><Label>辅色</Label><input type="color" bind:value={bgColor2} class="h-9 w-full cursor-pointer rounded-md border border-border/60 bg-transparent" /></div>
			<div class="grid gap-1.5"><Label>强调色</Label><input type="color" bind:value={bgColor3} class="h-9 w-full cursor-pointer rounded-md border border-border/60 bg-transparent" /></div>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div class="grid gap-1.5"><Label>浓度（{Math.round(intensityArr[0] * 100)}%）</Label><Slider bind:value={intensityArr} min={0.05} max={0.9} step={0.05} class="mt-3" /></div>
			<div class="grid gap-1.5"><Label>速度（{speedArr[0].toFixed(1)}x）</Label><Slider bind:value={speedArr} min={0.2} max={3} step={0.1} class="mt-3" /></div>
		</div>
	</div>

	<div class="flex flex-col gap-3">
		<h2 class="font-heading text-lg font-medium">数据备份</h2>
		<p class="text-sm text-muted-foreground">导出你有权访问的全部内容（文章/项目/文档）。可选择加密导出，仅持有密码者可解密。</p>
		<div class="flex items-center gap-2">
			<Input type="password" bind:value={backupPass} placeholder="加密密码（留空则不加密）" class="max-w-xs" />
			<Button onclick={exportBackup} variant="outline"><Download class="h-4 w-4 mr-2" />导出备份</Button>
		</div>
		{#if backupMsg}
			<p class="text-sm text-muted-foreground">{backupMsg}</p>
		{/if}
	</div>

	<div class="flex items-center gap-3">
		<Button onclick={save} disabled={saving}>
			<Save class="h-4 w-4 mr-2" />
			{saving ? "保存中..." : "保存设置"}
		</Button>
		{#if saved}
			<Badge variant="secondary">已保存</Badge>
		{/if}
	</div>
</div>