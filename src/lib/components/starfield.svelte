<script lang="ts">
	import { onMount } from "svelte";

	let { color = "#cc785c", count = 70, lineDist = 140, speed = 0.3 }: { color?: string; count?: number; lineDist?: number; speed?: number } = $props();

	let canvas: HTMLCanvasElement | undefined = $state(undefined);

	onMount(() => {
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		let stars: { x: number; y: number; r: number; vx: number; vy: number; tw: number; ph: number }[] = [];
		let raf = 0;
		let w = 0, h = 0;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);

		// Reduced motion: draw static once, no animation loop
		const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

		function resize() {
			w = canvas!.offsetWidth; h = canvas!.offsetHeight;
			canvas!.width = w * dpr; canvas!.height = h * dpr;
			ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
			stars = Array.from({ length: count }, () => ({
				x: Math.random() * w,
				y: Math.random() * h,
				r: 0.6 + Math.random() * 1.6,
				vx: (Math.random() - 0.5) * speed * 0.18,
				vy: (Math.random() - 0.5) * speed * 0.18,
				tw: 0.3 + Math.random() * 0.7,
				ph: Math.random() * Math.PI * 2
			}));
		}

		function draw(t: number) {
			ctx!.clearRect(0, 0, w, h);
			// lines
			for (let i = 0; i < stars.length; i++) {
				for (let j = i + 1; j < stars.length; j++) {
					const a = stars[i], b = stars[j];
					const dx = a.x - b.x, dy = a.y - b.y;
					const d = Math.sqrt(dx * dx + dy * dy);
					if (d < lineDist) {
						const alpha = (1 - d / lineDist) * 0.35;
						ctx!.strokeStyle = "rgba(204,120,92," + alpha + ")";
						ctx!.lineWidth = 0.6;
						ctx!.beginPath(); ctx!.moveTo(a.x, a.y); ctx!.lineTo(b.x, b.y); ctx!.stroke();
					}
				}
			}
			// stars
			for (const s of stars) {
				const tw = reduce ? 1 : 0.55 + 0.45 * Math.sin(t * 0.001 * speed * 8 + s.ph);
				ctx!.globalAlpha = tw;
				ctx!.fillStyle = color;
				ctx!.beginPath(); ctx!.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx!.fill();
				if (!reduce) { s.x += s.vx; s.y += s.vy; if (s.x < -5) s.x = w + 5; if (s.x > w + 5) s.x = -5; if (s.y < -5) s.y = h + 5; if (s.y > h + 5) s.y = -5; }
			}
			ctx!.globalAlpha = 1;
		}

		function loop(t: number) { draw(t); raf = requestAnimationFrame(loop); }
		resize();
		window.addEventListener("resize", resize);
		if (reduce) { draw(0); } else { raf = requestAnimationFrame(loop); }
		return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
	});
</script>

<canvas bind:this={canvas} class="absolute inset-0 h-full w-full" aria-hidden="true"></canvas>