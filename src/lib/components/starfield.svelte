<script lang="ts">
	/**
	 * 星空粒子层（背景装饰）。
	 *
	 * 性能要点（2026-09-25 重写，原实现是整站卡顿源）：
	 * 1. 连线从 O(n²) 全对比较改为**空间网格**（cell = lineDist），只比相邻 5 个格子；
	 * 2. 连线按透明度**分 5 档批量描边**：原来每帧最多 4005 次 stroke() + 4005 次
	 *    strokeStyle 赋值，现在固定 5 次——这是最大的一笔收益；
	 * 3. 帧率上限 30fps（背景装饰不需要 60，省一半 CPU/GPU）；
	 * 4. resize 防抖 150ms，且**按缩放比例搬运坐标**而非整批重建（避免拖窗口时闪烁+重算）；
	 * 5. 粒子数按**画布面积**自适应，小预览框自动变少，4K 屏也不会密度爆炸；
	 * 6. 低端设备（逻辑核心 ≤ 4）自动降到六成；prefers-reduced-motion 只静态画一次；
	 * 7. 页面不可见时停 rAF。
	 */
	import { onMount } from "svelte";

	let {
		color = "#cc785c",
		count = 70,
		lineDist = 140,
		speed = 0.3,
		fps = 30
	}: { color?: string; count?: number; lineDist?: number; speed?: number; fps?: number } = $props();

	let canvas: HTMLCanvasElement | undefined = $state(undefined);
	/** onMount 内赋值：参数变化时重建粒子（设置页预览拖动滑块用）。 */
	let rebuild: (() => void) | null = null;

	/** #rgb / #rrggbb → "r,g,b"，解析失败回落原硬编码色。 */
	function toRgb(hex: string): string {
		const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex || "").trim());
		if (!m) return "204,120,92";
		let h = m[1];
		if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
		const n = parseInt(h, 16);
		return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
	}

	onMount(() => {
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		type Star = { x: number; y: number; r: number; vx: number; vy: number; tw: number; ph: number };
		let stars: Star[] = [];
		let raf = 0;
		let w = 0, h = 0;
		let lastFrame = 0;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		const weak = (navigator.hardwareConcurrency || 8) <= 4;
		const frameMs = 1000 / Math.max(15, Math.min(fps, 60));
		const LEVELS = 5; // 透明度分档数
		const MAX_ALPHA = 0.35;

		// ---- 空间网格：每帧 O(n) 重建桶，连线只查相邻格 ----
		let cols = 0, rows = 0;
		let buckets: number[][] = [];
		const NEIGHBORS = [
			[0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]
		];

		function targetCount(): number {
			const byArea = Math.round((w * h) / 16000);
			let n = Math.min(count, byArea);
			if (weak) n = Math.round(n * 0.6);
			return Math.max(18, n);
		}

		function spawn(n: number) {
			stars = Array.from({ length: n }, () => ({
				x: Math.random() * (w || 1),
				y: Math.random() * (h || 1),
				r: 0.6 + Math.random() * 1.6,
				vx: (Math.random() - 0.5) * speed * 0.18,
				vy: (Math.random() - 0.5) * speed * 0.18,
				tw: 0.3 + Math.random() * 0.7,
				ph: Math.random() * Math.PI * 2
			}));
		}

		function resize() {
			const nw = canvas!.offsetWidth || 1;
			const nh = canvas!.offsetHeight || 1;
			const sx = w ? nw / w : 1;
			const sy = h ? nh / h : 1;
			w = nw; h = nh;
			canvas!.width = Math.round(w * dpr);
			canvas!.height = Math.round(h * dpr);
			ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
			if (!stars.length) {
				spawn(targetCount());
			} else {
				// 按比例搬运，避免拖窗口时整片重排导致闪一下
				for (const s of stars) { s.x *= sx; s.y *= sy; }
				const tc = targetCount();
				if (Math.abs(tc - stars.length) > Math.max(8, stars.length * 0.25)) spawn(tc);
			}
			if (reduce) draw(0);
		}

		function buildGrid() {
			const cell = Math.max(24, lineDist);
			const nc = Math.max(1, Math.ceil(w / cell));
			const nr = Math.max(1, Math.ceil(h / cell));
			if (nc !== cols || nr !== rows || buckets.length !== nc * nr) {
				cols = nc; rows = nr;
				buckets = Array.from({ length: cols * rows }, () => [] as number[]);
			} else {
				for (const b of buckets) b.length = 0;
			}
			for (let i = 0; i < stars.length; i++) {
				const cx = Math.min(cols - 1, Math.max(0, (stars[i].x / cell) | 0));
				const cy = Math.min(rows - 1, Math.max(0, (stars[i].y / cell) | 0));
				buckets[cy * cols + cx].push(i);
			}
		}

		function draw(t: number) {
			ctx!.clearRect(0, 0, w, h);

			// 1) 推进位置
			if (!reduce) {
				for (const s of stars) {
					s.x += s.vx; s.y += s.vy;
					if (s.x < -5) s.x = w + 5; else if (s.x > w + 5) s.x = -5;
					if (s.y < -5) s.y = h + 5; else if (s.y > h + 5) s.y = -5;
				}
			}

			// 2) 连线：网格 + 分档批量描边
			buildGrid();
			const paths: Path2D[] = [];
			for (let l = 0; l < LEVELS; l++) paths.push(new Path2D());
			const cell = Math.max(24, lineDist);
			for (let cy = 0; cy < rows; cy++) {
				for (let cx = 0; cx < cols; cx++) {
					const list = buckets[cy * cols + cx];
					if (!list.length) continue;
					for (const [dx, dy] of NEIGHBORS) {
						const nx = cx + dx, ny = cy + dy;
						if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
						const same = dx === 0 && dy === 0;
						const other = buckets[ny * cols + nx];
						for (const i of list) {
							const a = stars[i];
							for (const j of other) {
								if (same && j <= i) continue;
								const b = stars[j];
								const ddx = a.x - b.x, ddy = a.y - b.y;
								const d = Math.sqrt(ddx * ddx + ddy * ddy);
								if (d >= lineDist) continue;
								const alpha = (1 - d / lineDist) * MAX_ALPHA;
								let lvl = ((alpha / MAX_ALPHA) * LEVELS) | 0;
								if (lvl >= LEVELS) lvl = LEVELS - 1;
								paths[lvl].moveTo(a.x, a.y);
								paths[lvl].lineTo(b.x, b.y);
							}
						}
					}
				}
			}
			const rgb = toRgb(color);
			ctx!.lineWidth = 0.6;
			for (let l = 0; l < LEVELS; l++) {
				const a = (((l + 0.5) / LEVELS) * MAX_ALPHA).toFixed(3);
				ctx!.strokeStyle = `rgba(${rgb},${a})`;
				ctx!.stroke(paths[l]);
			}

			// 3) 星点
			for (const s of stars) {
				const tw = reduce ? 1 : 0.55 + 0.45 * Math.sin(t * 0.001 * speed * 8 + s.ph);
				ctx!.globalAlpha = tw;
				ctx!.fillStyle = color;
				ctx!.beginPath();
				ctx!.arc(s.x, s.y, s.r, 0, Math.PI * 2);
				ctx!.fill();
			}
			ctx!.globalAlpha = 1;
		}

		function loop(t: number) {
			raf = requestAnimationFrame(loop);
			// 限帧：背景装饰 30fps 足够，省一半开销
			if (t - lastFrame < frameMs - 1) return;
			lastFrame = t;
			draw(t);
		}
		function start() { if (raf === 0 && !reduce) { lastFrame = 0; raf = requestAnimationFrame(loop); } }
		function stop() { if (raf !== 0) { cancelAnimationFrame(raf); raf = 0; } }

		let rt: ReturnType<typeof setTimeout> | undefined;
		const onResize = () => { clearTimeout(rt); rt = setTimeout(resize, 150); };
		const onVis = () => { if (document.hidden) stop(); else start(); };

		resize();
		window.addEventListener("resize", onResize);
		document.addEventListener("visibilitychange", onVis);
		if (reduce) draw(0); else start();

		// 供 $effect 调用：设置页拖动滑块时按新参数重建
		rebuild = () => {
			if (!w || !h) return;
			spawn(targetCount());
			if (reduce) draw(0);
		};

		return () => {
			rebuild = null;
			stop();
			clearTimeout(rt);
			window.removeEventListener("resize", onResize);
			document.removeEventListener("visibilitychange", onVis);
		};
	});

	// 参数变化（设置页拖动滑块 / 主题切换）时重建粒子
	$effect(() => {
		void color; void count; void lineDist; void speed;
		rebuild?.();
	});
</script>

<canvas bind:this={canvas} class="absolute inset-0 h-full w-full" aria-hidden="true"></canvas>
