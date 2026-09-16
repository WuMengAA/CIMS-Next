<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { toast } from "svelte-sonner";
	import { MonitorSmartphone, ShieldCheck, CornerDownRight, ArrowLeft } from "@lucide/svelte";

	// 二次绑定引导页：进入集控面板前的「班级身份绑定」。
	// 为什么不直接拒绝访问：集控面板是设备管理入口，账号需要知道自己属于哪个班，
	// 电教委员才能操作本班设备。未绑定的用户引导其完成绑定后即可访问，
	// 而不是被拒之门外（避免「我明明有权限，为什么进不去」的疑惑）。
	let { data } = $props<{ data: { username: string; displayName: string; className: string; gradeName: string } }>();

	let className = $state(data.className);
	let gradeName = $state(data.gradeName);
	let saving = $state(false);
	let error = $state("");

	async function submit() {
		error = "";
		if (!className.trim() || !gradeName.trim()) {
			error = "请填写班级与年级（例如：高一(3)班 / 高一）";
			return;
		}
		saving = true;
		try {
			const res = await fetch("/api/me", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ className: className.trim(), gradeName: gradeName.trim() })
			});
			const d = await res.json();
			if (res.ok && d.ok) {
				toast.success("班级绑定成功，正在进入集控面板…");
				window.location.href = "/admin/console";
				return;
			}
			error = d.error || "保存失败，请重试";
		} catch (e) {
			error = "网络错误，请重试";
		}
		saving = false;
	}
</script>

<svelte:head>
	<title>班级绑定 · 集控面板 | Stelarith</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="flex min-h-[60vh] items-center justify-center p-4">
	<div class="w-full max-w-md rounded-xl border border-border/60 bg-card p-6 shadow-sm">
		<div class="mb-1 flex size-11 items-center justify-center rounded-lg bg-primary/15 text-primary">
			<MonitorSmartphone class="size-5" />
		</div>
		<h1 class="mt-3 font-heading text-xl font-semibold">进入集控面板前，请完成班级绑定</h1>
		<p class="mt-2 text-sm leading-relaxed text-muted-foreground">
			你好，<span class="font-medium text-foreground">{data.displayName}</span>（@{data.username}）。
			集控面板用于教室设备管理，需要先确认你的班级身份，才能正确显示你所属班级的设备与操作权限。
		</p>

		<div class="mt-5 flex flex-col gap-4">
			<div class="grid gap-1.5">
				<Label for="grade">年级</Label>
				<Input id="grade" bind:value={gradeName} placeholder="如：高一 / 高二 / 高三" />
			</div>
			<div class="grid gap-1.5">
				<Label for="class">班级</Label>
				<Input id="class" bind:value={className} placeholder="如：高一(3)班 / 信息中心" onkeydown={(e) => { if (e.key === "Enter") submit(); }} />
				<p class="text-xs text-muted-foreground">可与学校正式班级名一致，绑定后可在「账号」页随时修改。</p>
			</div>

			{#if error}
				<p class="text-sm text-destructive">{error}</p>
			{/if}

			<div class="flex items-center gap-2">
				<Button onclick={submit} disabled={saving}>{saving ? "绑定中…" : "确认绑定并进入面板"}</Button>
				<Button variant="outline" href="/admin" class="gap-1.5">
					<ArrowLeft class="size-3.5" /> 返回后台
				</Button>
			</div>
		</div>

		<div class="mt-6 flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
			<ShieldCheck class="mt-0.5 size-3.5 shrink-0 text-primary" />
			<p>班级信息仅用于设备归属与权限范围判定，仅本人可见可改。<span class="inline-flex items-center gap-1 font-medium text-foreground"><CornerDownRight class="size-3" /> 绑定后即可访问集控面板</span></p>
		</div>
	</div>
</div>