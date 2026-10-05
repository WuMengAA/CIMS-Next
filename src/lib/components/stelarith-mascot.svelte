<script lang="ts">
	// 星集控 · 吉祥物（2026-10-05 · 借鉴 Grok 角色动效机制：弹簧插值 + 姿态状态机 + 多边形眨眼，全新造型）
	// 机制参考：grok-icon-study（spring/pose/eyes 思路），形象与版权独立。
	import { onMount, onDestroy } from "svelte";

	type State = "idle" | "curious" | "listening" | "happy";
	let { size = 96, interactive = true }: { size?: number; interactive?: boolean } = $props();

	// ── 弹簧（Grok 同款：临界阻尼趋近，不带频率项） ──
	const spring = (current: number, target: number, k = 0.12): number => current + (target - current) * k;

	// ── 姿态状态机（模板绑定 → $state，动画每帧触发重渲染） ──
	// 注意：变量名不能用 `state` —— Svelte rune 展开会把 `$state` 撞成
	// "Cannot use 'state' as a store"。改用 mood。
	let mood: State = $state("idle");
	let phase = $state(0);          // 时间相位（驱动呼吸/摆动）
	let eyeLid = $state(1);         // 眼皮开度 0..1（眨眼）
	let squash = $state(1);         // 纵向压扁（情绪）
	let tilt = $state(0);           // 头部倾斜
	let eyeTarget: { x: number; y: number } = $state({ x: 0, y: 0 }); // 视线
	let tx = $state(0);
	let ty = $state(0);             // 身体位移
	let spin = $state(0);           // 自旋
	let blinkTimer = 0;             // 纯内部计时（不绑定模板，无需 $state）

	const W = 96, H = 96, CX = 48, CY = 48;

	// 视线目标：interactive 时跟随指针（相对中心，clamp 到瞳孔范围）
	function onPointer(e: PointerEvent) {
		if (!interactive) return;
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const nx = ((e.clientX - r.left) / r.width - 0.5) * 2;
		const ny = ((e.clientY - r.top) / r.height - 0.5) * 2;
		eyeTarget = { x: Math.max(-4, Math.min(4, nx * 5)), y: Math.max(-3, Math.min(3, ny * 4)) };
	}

	function setState(s: State) {
		if (s === mood) return;
		mood = s;
		// 切换姿态：curious 前倾、happy 弹跳、listening 歪头
		if (s === "curious") tilt = -4;
		if (s === "happy") { squash = 1.15; ty = -3; }
		if (s === "listening") { tilt = 6; eyeTarget = { x: 0, y: -1 }; }
	}

	// 随机状态游走（登录页氛围用）
	function wander() {
		const pool: State[] = ["idle", "curious", "listening", "happy"];
		setState(pool[Math.floor(Math.random() * pool.length)]);
	}

	let raf = 0;
	let last = 0;
	function tick(ts: number) {
		const dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
		last = ts;
		phase += dt;

		// 眨眼：随机间隔 2.5-5s，眨眼 0.15s
		blinkTimer -= dt;
		if (blinkTimer <= 0) {
			blinkTimer = 2.5 + Math.random() * 2.5;
			eyeLid = 0;
		}
		eyeLid = spring(eyeLid, 1, 0.9);

		// 呼吸/身体位移
		const breath = Math.sin(phase * 1.9) * 1.2;
		ty = spring(ty, breath + (mood === "happy" ? -2 : 0), 0.08);
		squash = spring(squash, mood === "happy" ? 1.12 : mood === "curious" ? 0.97 : 1, 0.1);
		tilt = spring(tilt, 0, 0.08);
		spin = spring(spin, 0, 0.1);

		// 视线回中（无指针/非 interactive）
		eyeTarget = { x: spring(eyeTarget.x, 0, 0.1), y: spring(eyeTarget.y, 0, 0.1) };

		raf = requestAnimationFrame(tick);
	}

	onMount(() => {
		raf = requestAnimationFrame(tick);
		const w = window.setInterval(wander, 4000 + Math.random() * 2000);
		onDestroy(() => { cancelAnimationFrame(raf); window.clearInterval(w); });
	});
</script>

<svelte:head></svelte:head>

<div
	class="mascot inline-block"
	style="width:{size}px;height:{size}px"
	onpointermove={onPointer}
	onpointerleave={() => (eyeTarget = { x: 0, y: 0 })}
	role="img"
	aria-label="星集控吉祥物"
>
	<svg width="{size}" height="{size}" viewBox="0 0 96 96" style="overflow:visible">
		<g transform="translate({CX + tx} {CY + ty}) rotate({spin}) scale({squash}  {2 - squash})">
			<!-- 身体：圆角胶囊（控制台主机形象） -->
			<rect x="-22" y="-26" width="44" height="52" rx="14" fill="#1a1916" stroke="#e8d7a4" stroke-width="2.5" />
			<!-- 身体面板灯 -->
			<rect x="-14" y="-18" width="28" height="10" rx="5" fill="#22211d" stroke="#4a463c" stroke-width="1" />
			<circle cx="-8" cy="-13" r="2.2" fill="#e8d7a4" />
			<circle cx="0" cy="-13" r="2.2" fill="#6d675d" />
			<circle cx="8" cy="-13" r="2.2" fill="#c8542e" />
			<!-- 眼睛（多边形，开度=眨眼） -->
			<g transform="translate({eyeTarget.x} {eyeTarget.y + (1 - eyeLid) * 2.5})">
				<polygon points="-15,-4 -8,-10 -1,-4 -8,-2" fill="#ece7dc" stroke="#111" stroke-width="1.2" transform="translate(-9 -2) scale(1 {Math.max(0.08, eyeLid)})" />
				<polygon points="1,-4 8,-10 15,-4 8,-2" fill="#ece7dc" stroke="#111" stroke-width="1.2" transform="translate(9 -2) scale(1 {Math.max(0.08, eyeLid)})" />
			</g>
			<!-- 嘴（happy 笑 / idle 平） -->
			<path
				d="{mood === 'happy' ? 'M -8 10 Q 0 18 8 10' : 'M -7 10 Q 0 13 7 10'}"
				fill="none" stroke="#ece7dc" stroke-width="1.6" stroke-linecap="round"
			/>
			<!-- 天线（信号收发） -->
			<line x1="0" y1="-26" x2="{eyeTarget.x}" y2="-34" stroke="#e8d7a4" stroke-width="1.6" stroke-linecap="round" />
			<circle cx="{eyeTarget.x}" cy="-35" r="3" fill="#e8d7a4" />
		</g>
	</svg>
</div>

<style>
	.mascot {
		cursor: default;
		user-select: none;
	}
	.mascot svg {
		display: block;
	}
</style>