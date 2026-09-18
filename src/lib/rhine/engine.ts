/**
 * 莱茵档案阵列 —— Three.js 引擎骨架
 *
 * 职责边界：
 *   engine 只负责「渲染基础设施」——renderer / scene / camera / 光照 / 渲染循环 /
 *   尺寸自适应 / 资源释放。阵列几何、卡片材质、切列切卡交互由上层模块叠加。
 *
 * 设计约束：
 *   1. 纯客户端模块，只能在 onMount 内动态 import，SSR 阶段绝不触碰。
 *   2. 观察者模式而非 Svelte 响应式 —— 渲染循环里每帧读写 $state 会造成
 *      无意义的代理开销，且会让 60fps 循环受脏检查牵制。
 *   3. dispose() 必须幂等且彻底：WebGL 上下文在浏览器里是稀缺资源
 *      （上限 ~16 个），SPA 来回切页若泄漏会让后续页面直接白屏。
 */
import * as THREE from "three";

export type EngineOptions = {
	/** 挂载容器，尺寸即画布尺寸 */
	canvas: HTMLCanvasElement;
	/** 容器元素，用于 ResizeObserver 观测 */
	host: HTMLElement;
	/** 像素比上限，档机降级用 */
	maxPixelRatio?: number;
	/** 是否启用 antialias，移动端可以关掉换帧率 */
	antialias?: boolean;
	/** 视场角（度）。莱茵构图必须用长焦小 fov，默认 18 */
	fov?: number;
	/** 初始主题，决定灯光强度档位 */
	dark?: boolean;
	/** 每帧回调，dt 单位秒、已 clamp 到 0.1s 防止切回标签页时瞬移 */
	onFrame?: (dt: number, elapsed: number) => void;
	/** 尺寸变化回调，宽高为 CSS 像素 */
	onResize?: (width: number, height: number) => void;
};

export type RhineEngine = {
	renderer: THREE.WebGLRenderer;
	scene: THREE.Scene;
	camera: THREE.PerspectiveCamera;
	/** 容器当前 CSS 尺寸 */
	size: { width: number; height: number };
	/** 自引擎启动累计的秒数（受 timeScale 影响） */
	elapsed: number;
	/** 时间缩放，用于减速/定格动画 */
	timeScale: number;
	/**
	 * 相机到注视点的距离（世界单位）。
	 *
	 * 由上层根据「期望取景宽度 + fov」算好后写入 —— 距离与 fov 必须同源，
	 * 在别处各算一份必然会在窄屏上错位。engine 自己不去推导它，
	 * 只负责在 ResizeObserver 首帧时把初始值补上。
	 */
	cameraDistance: number;
	/** 手动触发一次渲染（暂停循环后想单帧刷新时用） */
	renderOnce: () => void;
	/** 切换明暗主题：同步光照强度与曝光 */
	setDark: (dark: boolean) => void;
	/** 暂停/恢复渲染循环 */
	setPaused: (paused: boolean) => void;
	/** 释放全部 GPU 资源并断开观察者 */
	dispose: () => void;
};

const MAX_DT = 0.1;

/** 尊重系统「减弱动态效果」偏好 —— 无障碍基线 */
export function prefersReducedMotion(): boolean {
	if (typeof window === "undefined") return false;
	return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
}

/** 粗判低性能设备：小屏 + 低内存，用于自动降级像素比 */
function isLowPowerDevice(): boolean {
	if (typeof navigator === "undefined") return false;
	const cores = (navigator as Navigator & { hardwareConcurrency?: number }).hardwareConcurrency ?? 8;
	const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
	const coarse = window.matchMedia?.("(pointer: coarse)")?.matches === true;
	return (coarse && cores <= 4) || mem <= 2 || cores <= 2;
}

/**
 * 创建莱茵引擎。调用方必须在组件销毁时调用 dispose()。
 */
export function createRhineEngine(options: EngineOptions): RhineEngine {
	const { canvas, host } = options;

	const maxPixelRatio = options.maxPixelRatio ?? (isLowPowerDevice() ? 1.5 : 2);
	const antialias = options.antialias ?? !isLowPowerDevice();

	const renderer = new THREE.WebGLRenderer({
		canvas,
		antialias,
		alpha: true,
		// 我们自己在主题切换时改 clearColor，不需要浏览器猜测
		premultipliedAlpha: true,
		powerPreference: "high-performance",
		stencil: false
	});
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPixelRatio));
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.05;
	// 卡片需要半透明磨砂叠加，混合交给着色器自己算
	renderer.autoClear = true;

	const scene = new THREE.Scene();
	scene.background = null; // 透出页面底色，让莱茵令牌接管

	// 极淡的线性雾：给档案墙一点纵深呼吸感（远端轻微退后、边缘淡出），
	// 密度必须小到不糊住卡片文字 —— 只是「氛围」，不是遮挡。
	// 范围锚在「卡片阵列所在距离」附近：最近列完全清晰，最远列只淡出一丝，
	// 恰好把 3 列的纵深摆出来。密度极低时它也可以是页面底色的一张羽化网。
	const fog = new THREE.Fog("#000000", 22, 70);
	scene.fog = fog;
	function setFogColor(dark: boolean) {
		fog.color.set(dark ? "#0d1418" : "#e5e0da");
	}
	setFogColor(options.dark ?? false);

	// 长焦：莱茵靠小 fov + 远距离压缩透视，让整面档案墙近乎正交。
	// aspect 先给 1，applySize() 会立刻用容器真实尺寸覆盖。
	const camera = new THREE.PerspectiveCamera(options.fov ?? 18, 1, 0.1, 800);
	// 长焦：莱茵靠小 fov + 远距离压缩透视，让整面档案墙近乎正交
	// 此时相机仍是未生效的初始位姿，先放好再让上层按真实尺寸重算
	camera.position.set(0, 0, 60);
	camera.lookAt(0, 0, 0);

	// ── 光照：复刻 RhineLabUI 的摄影棚三点布光 ──────────────────────
	// 半球光垫底，两盏平行光分别做主体造型与背面补光
	const hemi = new THREE.HemisphereLight("#fffaf5", "#b4a18c", 0.65);
	const key = new THREE.DirectionalLight("#fff7ed", 1.4);
	key.position.set(-6, 14, -5);
	const fill = new THREE.DirectionalLight("#ffffff", 0.6);
	fill.position.set(7, 8, -10);
	scene.add(hemi, key, fill);

	const ambient = new THREE.AmbientLight("#ffffff", 0.18);
	scene.add(ambient);

	/**
	 * 光照必须跟随主题，否则两头不讨好。
	 *
	 * 卡面底色直接来自 Canvas 纹理：深色主题下 albedo 约 0.014（近黑），
	 * 亮色主题下约 0.82。同一套灯光不可能同时照亮这两个极端 ——
	 * 按亮色配的光打在深色卡上等于没打（卡片糊成一片黑），
	 * 按深色配的光打在亮色卡上直接过曝（整面墙白得看不见字）。
	 *
	 * 所以给两组强度：亮色沿用参考实现的摄影棚布光，
	 * 深色则大幅提高，把深色卡面「提」到可读的亮度区间。
	 */
	function setLightIntensity(dark: boolean) {
		if (dark) {
			hemi.intensity = 1.15;
			key.intensity = 1.55;
			fill.intensity = 0.85;
			ambient.intensity = 0.5;
		} else {
			hemi.intensity = 0.65;
			key.intensity = 1.4;
			fill.intensity = 0.6;
			ambient.intensity = 0.18;
		}
	}
	setLightIntensity(options.dark ?? false);

	// ── 尺寸自适应 ────────────────────────────────────────────────
	const size = { width: 1, height: 1 };

	function applySize(width: number, height: number) {
		const w = Math.max(1, Math.floor(width));
		const h = Math.max(1, Math.floor(height));
		size.width = w;
		size.height = h;
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		options.onResize?.(w, h);
	}

	const rect = host.getBoundingClientRect();
	applySize(rect.width, rect.height);

	let resizeObserver: ResizeObserver | null = null;
	if (typeof ResizeObserver !== "undefined") {
		let raf = 0;
		resizeObserver = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (!entry) return;
			// 合并同一帧内的多次回调，避免拖拽窗口时重复重建投影矩阵
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(() => {
				const box = entry.contentRect;
				applySize(box.width, box.height);
				renderOnce();
			});
		});
		resizeObserver.observe(host);
	}

	// ── 渲染循环 ──────────────────────────────────────────────────
	let rafId = 0;
	let last = 0;
	let elapsed = 0;
	let paused = false;
	let disposed = false;

	const clock = { timeScale: 1 };

	function frame(now: number) {
		if (disposed) return;
		rafId = requestAnimationFrame(frame);

		const rawDt = last === 0 ? 1 / 60 : (now - last) / 1000;
		last = now;
		// 切标签页回来 dt 可能是几十秒，clamp 掉防止动画瞬移
		const dt = Math.min(rawDt, MAX_DT) * clock.timeScale;
		elapsed += dt;

		options.onFrame?.(dt, elapsed);
		renderer.render(scene, camera);
	}

	function renderOnce() {
		if (disposed) return;
		options.onFrame?.(0, elapsed);
		renderer.render(scene, camera);
	}

	function start() {
		if (disposed || rafId !== 0) return;
		last = 0;
		rafId = requestAnimationFrame(frame);
	}

	function stop() {
		if (rafId !== 0) {
			cancelAnimationFrame(rafId);
			rafId = 0;
		}
	}

	// 页面不可见时停渲染，省电且避免回来后补帧
	function onVisibility() {
		if (document.hidden) stop();
		else if (!paused) start();
	}
	document.addEventListener("visibilitychange", onVisibility);
	start();

	// ── 资源释放 ──────────────────────────────────────────────────
	/**
	 * 递归释放场景里的一切 GPU 资源。
	 * three 的 dispose() 不会自动级联，必须手动遍历 geometry / material / texture，
	 * 否则每次进入 /docs 都会泄漏显存直到上下文丢失。
	 */
	function disposeObject(root: THREE.Object3D) {
		root.traverse((obj) => {
			const mesh = obj as THREE.Mesh;
			mesh.geometry?.dispose?.();

			const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
			for (const mat of mats) {
				// 材质上可能挂着任意数量的贴图，遍历自己的属性找 Texture 实例
				for (const value of Object.values(mat as unknown as Record<string, unknown>)) {
					if (value instanceof THREE.Texture) value.dispose();
				}
				mat.dispose();
			}
		});
	}

	function dispose() {
		if (disposed) return;
		disposed = true;
		stop();
		document.removeEventListener("visibilitychange", onVisibility);
		resizeObserver?.disconnect();
		resizeObserver = null;

		disposeObject(scene);
		scene.clear();

		renderer.dispose();
		renderer.forceContextLoss?.();
		renderer.domElement.width = 0;
		renderer.domElement.height = 0;
	}

	return {
		renderer,
		scene,
		camera,
		size,
		get elapsed() {
			return elapsed;
		},
		set timeScale(v: number) {
			clock.timeScale = v;
		},
		get timeScale() {
			return clock.timeScale;
		},
		cameraDistance: 60,
		renderOnce,
		setDark(dark: boolean) {
			setLightIntensity(dark);
			setFogColor(dark);
			// 深色下曝光压一点，避免提亮后的卡面泛白
			renderer.toneMappingExposure = dark ? 0.98 : 1.05;
		},
		setPaused(next: boolean) {
			paused = next;
			if (next) stop();
			else if (!document.hidden) start();
		},
		dispose
	};
}

/** 主题切换时同步渲染器的清屏色与曝光 */
export function applyEngineTheme(engine: RhineEngine, dark: boolean) {
	engine.scene.environment = null;
	engine.renderer.toneMappingExposure = dark ? 0.92 : 1.05;
}
