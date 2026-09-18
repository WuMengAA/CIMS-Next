<!--
  莱茵档案阵列 —— Three.js 卡片视口
  ================================================================================
  这是文档库的主角：把 40 份教程铺成一面可导航的三维卡片墙。

    左右方向键  →  切换分组（整列推移，镜头横移）
    上下方向键  →  切换组内文章（卡片位滚动，镜头纵移）
    Enter/点击  →  打开当前选中的档案
    W A S D     →  同上（游戏化按键，莱茵风格）
    触摸左滑/右滑 → 切分组
    触摸上滑/下滑 → 切文章

  与 RhineLabUI 的关系：几何常量（卡片 5×3.7、列距 5.2）与摄影棚布光沿用其
  设计语言，但导航模型从「9 泳道循环池」简化为「分组即列、文章即行」，
  因为我们有天然的层级结构，不需要靠循环池制造无限感。
-->
<script lang="ts">
	import { onMount } from "svelte";
	import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, CornerDownLeft } from "@lucide/svelte";
	import {
		CAMERA_ELEVATION_DEG,
		CAMERA_FOV,
		CAMERA_ROW_BIAS,
		CAMERA_YAW_DEG,
		CAMERA_Y_VIEW_SCALE,
		COLUMN_SPACING,
		MAX_ASPECT_FOV,
		REF_ASPECT,
		ROW_SPACING,
		WALL_FILL,
		buildArchive,
		cellToWorld,
		computeFramingHeight,
		distanceForFraming,
		navigate,
		unwrap,
		type ArchiveCell,
		type ArchiveGroup
	} from "$lib/rhine/archive";
	import { LIGHT_PALETTE, DARK_PALETTE, type CardPalette } from "$lib/rhine/card-texture";

	type Props = {
		/** 后端传入的扁平文档列表 */
		docs: any[];
		/** 当前是否暗色主题，用于换调色板 */
		dark?: boolean;
		/** 打开档案，默认走整页跳转 */
		onOpen?: (href: string) => void;
	};

	let { docs, dark = false, onOpen }: Props = $props();

	const groups = $derived(buildArchive(docs));
	const total = $derived(docs.length);

	// ── 选中状态 ────────────────────────────────────────────────────
	// lane 允许越界（-1 / N）表达「已滑到屏幕外的相邻列」，unwrap 负责把
	// 选中卡带回来。这样左右切的过渡动画才不会在边界处突然反向。
	let lane = $state(0);
	let row = $state(0);
	let ready = $state(false);
	let webglFailed = $state(false);

	const cell: ArchiveCell = $derived({ lane: unwrap(lane, groups.length), row });

	const currentGroup: ArchiveGroup | undefined = $derived(groups[unwrap(lane, groups.length)]);
	const currentDoc = $derived(currentGroup?.docs[row]);

	// ── 3D 场景 ────────────────────────────────────────────────────
	let hostEl: HTMLDivElement | undefined = $state();
	let canvasEl: HTMLCanvasElement | undefined = $state();

	/** 引擎与阵列的句柄，跨 async 边界用普通变量持有，避免被响应式追踪 */
	let engine: any = null;
	let array: any = null;

	/** 镜头的当前值与目标值，逐帧做指数插值 */
	const cam = { x: 0, y: 0, tx: 0, ty: 0 };

	/**
	 * 当前镜头实际取景的横向世界宽度。
	 *
	 * 这是「取景」与「距离」之间唯一的桥：fov 与相机距离都由它推导，
	 * 而它本身由 retargetCamera() 根据「整墙能否看全」定下来。
	 * 三者同源是这一版最重要的修正 —— 第一版各算各的，
	 * 于是出现「镜头锁在墙心、却按跟拍的距离取景」的自相矛盾机位。
	 */
	let framedWidth = 0;

	/** 键盘/触摸的输入节流，防止按住方向键一次跳十格 */
	let lastInputAt = 0;
	const INPUT_COOLDOWN = 110;

	/** 触摸起点 */
	let touchStart: { x: number; y: number; t: number } | null = null;

	function pickPalette(isDark: boolean): CardPalette {
		return isDark ? DARK_PALETTE : LIGHT_PALETTE;
	}

	/**
	 * 镜头注视点的目标偏移（相对墙心）。
	 *
	 * ⚠️ cam.tx / cam.ty 存的是**相对墙心的偏移量**，不是世界绝对坐标。
	 * 相机是偏轴的（yaw 22°、elevation 9°）。若把绝对世界坐标当注视点，
	 * 注视点会随卡片四处游走，而相机到它的方向恒定 —— 结果是每张卡都落到
	 * 镜头轴线的同一处，整面墙被剪成楔形（右边三列浮空、左侧行贴地）。
	 * 存偏移量、让相机对着「墙心 + 偏移」，所有卡片才落在同一个成像平面上。
	 *
	 * 横向：整面墙能不能一次看全，决定是「锁定」还是「跟拍」。
	 *   ① 能看全 → 注视点横向锁在墙心（偏移 0），全程不动，
	 *      切列时只有选中高亮在静止的墙面上移动，最能体现「这是一面阵列」。
	 *   ② 看不全 → 注视点跟着选中列平移，否则边缘的列会跑出画面。
	 *
	 * 纵向：整列装得下就垂直居中整列，否则让选中卡落到偏上 1/3 处。
	 */
	function retargetCamera() {
		const laneCount = groups.length;
		const framing = framingHeight();
		const wallWidth = laneCount * COLUMN_SPACING;
		const fitAll = wallWidth <= framing * viewAspect();

		const { x, y } = cellToWorld(cell);
		const rows = currentGroup?.docs.length ?? 1;

		// ① 横向：锁定时偏移恒为 0；跟拍时偏移 = 选中列相对墙心的距离
		const wallCenterX = ((laneCount - 1) * COLUMN_SPACING) / 2;
		cam.tx = fitAll ? 0 : x - wallCenterX;

		// ② 纵向：先求出「希望选中卡落在画面里的哪个世界高度」，
		//    再减去墙心，得到偏移量
		const columnHeight = (rows - 1) * ROW_SPACING + 3.7;
		const aimYAbsolute =
			columnHeight <= framing * 0.92
				? y - ((rows - 1) * ROW_SPACING) / 2 // 整列装得下 → 居中整列
				: y - CAMERA_ROW_BIAS / CAMERA_Y_VIEW_SCALE; // 否则选中卡偏上 1/3
		cam.ty = aimYAbsolute - wallCenterY();

		// ③ 距离切换必须与 ① 的条件同源 —— 否则会出现
		//    「注视点锁在墙心，却按跟拍的距离取景」这种自相矛盾的机位。
		//    整墙可见时用 WALL_FILL 轻微出血，避免两侧留出大片空墙。
		framedWidth = fitAll ? wallWidth * WALL_FILL : framing * viewAspect();
	}

	/**
	 * 整面墙的纵向中心。
	 *
	 * 各列行数可能不同，取最长的一列作为墙高基准 —— 这样行数少的列
	 * 会自然地相对墙心偏上，符合「分组长短不一」的直觉。
	 */
	function wallCenterY() {
		const maxRows = Math.max(...groups.map((g) => g.docs.length), 1);
		return -((maxRows - 1) * ROW_SPACING) / 2;
	}

	/** 当前画布宽高比（未就绪时按基准估） */
	function viewAspect() {
		if (engine && engine.size.height > 0) return engine.size.width / engine.size.height;
		return REF_ASPECT;
	}

	/** 当前镜头实际取景的横向世界宽度（由 retargetCamera 决定） */
	function framedWidthNow() {
		if (framedWidth > 0) return framedWidth;
		const laneCount = groups.length;
		const framing = framingHeight();
		const wallWidth = laneCount * COLUMN_SPACING;
		return wallWidth <= framing * viewAspect() ? wallWidth * WALL_FILL : framing * viewAspect();
	}

	/**
	 * 按「期望取景宽度」反推 fov 与相机距离。
	 *
	 * 关键点：距离由**取景高度**与 fov 共同决定，
	 * 取景高度固定为 REF_ASPECT 基准值 → 卡片在屏幕上的大小只由取景宽度决定。
	 * 这消除了第一版的正反馈 bug：那版把取景高度按实时宽高比缩放，
	 * 结果宽容器 → 取景变高 → 判定能装更多列 → 越推越远。
	 *
	 * fov 只在窄屏放大（保证至少看到约 3 列），且有硬上限，防止广角畸变。
	 */
	function updateProjection() {
		if (!engine) return;
		const framing = framingHeight();
		const wantWidth = framedWidthNow();
		const target = wantWidth / framing;
		// 宽容器下最多缩到基准 fov（保持长焦压缩），窄容器才放大
		const fov = Math.min(Math.max(target, CAMERA_FOV), MAX_ASPECT_FOV);
		engine.camera.fov = fov;
		engine.camera.updateProjectionMatrix();
		engine.cameraDistance = distanceForFraming(fov, framing);
	}

	/**
	 * 由「墙心 + 固定偏轴角度 + 已算好的距离」推出相机位置。
	 *
	 * 莱茵的镜头永远从同一个斜角看向档案墙 —— 方位角与俯角恒定，
	 * 变的只是「看向墙上的哪一点」。这样切列时画面像是一台固定的机械臂
	 * 沿着墙面平移，而不是绕着卡片转，观感更稳、更有「终端」味。
	 *
	 * 几何关系（记墙心为 C，注视点为 L = C + aim，单位方向为 d）：
	 *   相机位置 P = L - d · distance      ← 从注视点沿反方向退开
	 *   视线方向    = d                     ← 于是 P 看向 L 的方向恒为 d
	 * 因为 d 恒定，无论 aim 怎么动，采到的都是同一组平行视线 ——
	 * 这正是「整面网格共面」被诚实投影到屏幕上的前提。
	 *
	 * ⚠️ 不能把绝对世界坐标当注视点：那样每张卡都落到镜头轴线的同一处，
	 * 整面墙会被剪成楔形（右边三列浮空、左侧行贴地）。这是第二版栽的坑。
	 */
	function applyCameraPose() {
		if (!engine) return;
		const yaw = (CAMERA_YAW_DEG * Math.PI) / 180;
		// three 的 Y 轴向上，屏幕上「俯视」= 相机在目标上方 → 取正仰角
		const elevation = (CAMERA_ELEVATION_DEG * Math.PI) / 180;

		const dir = {
			x: -Math.sin(yaw) * Math.cos(elevation),
			y: Math.sin(elevation),
			z: Math.cos(yaw) * Math.cos(elevation)
		};

		const distance = engine.cameraDistance ?? distanceForFraming(engine.camera.fov, framingHeight());

		// 墙心（恒定不动）+ 受选中格驱动的注视偏移
		const cx = ((groups.length - 1) * COLUMN_SPACING) / 2;
		const cy = wallCenterY();
		const lx = cx + cam.x;
		const ly = cy + cam.y;

		engine.camera.position.set(
			lx - dir.x * distance,
			ly - dir.y * distance,
			-dir.z * distance
		);
		engine.camera.lookAt(lx, ly, 0);
	}

	/** 当前阵列规模对应的取景高度（随分组数变化） */
	function framingHeight() {
		return computeFramingHeight(groups.length);
	}

	// ── 导航 ────────────────────────────────────────────────────────
	function move(axis: "lane" | "row", direction: number) {
		if (groups.length === 0) return;
		const now = performance.now();
		if (now - lastInputAt < INPUT_COOLDOWN) return;
		lastInputAt = now;

		const rawCell = { lane, row };
		const next = navigate(rawCell, groups, axis, direction);
		if (!next.moved) return;

		if (axis === "lane") {
			// 越界时允许 lane 走出 [-1, N]，画面上看起来是「滑到空白处被拦住」
			const targetLane = lane + direction;
			if (targetLane < 0 || targetLane >= groups.length) {
				// 边界处给一个轻微的顶回反馈而不是完全无响应
				cam.tx += direction * 0.35;
				return;
			}
			lane = targetLane;
			row = next.cell.row;
		} else {
			row = next.cell.row;
		}

		retargetCamera();
		array?.setSelection({ lane: unwrap(lane, groups.length), row }, null);
	}

	function openCurrent() {
		if (!currentDoc) return;
		const href = `/docs/${currentDoc.slug}`;
		if (onOpen) onOpen(href);
		else if (typeof window !== "undefined") window.location.href = href;
	}

	/** 点选某张卡：若已在中心则打开，否则先切到它 */
	function pickCard(slug: string) {
		if (currentDoc?.slug === slug) {
			openCurrent();
			return;
		}
		const group = groups.find((g) => g.docs.some((d) => d.slug === slug));
		if (!group) return;
		const target = group.docs.find((d) => d.slug === slug)!;
		lane = group.index;
		row = target.row;
		retargetCamera();
		array?.setSelection({ lane, row }, null);
	}

	// ── 事件绑定 ────────────────────────────────────────────────────
	function onKeydown(e: KeyboardEvent) {
		// 输入框里按键不拦
		const el = e.target as HTMLElement | null;
		if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
		if (el?.isContentEditable) return;

		switch (e.key) {
			case "ArrowLeft":
			case "a":
			case "A":
				e.preventDefault();
				move("lane", -1);
				break;
			case "ArrowRight":
			case "d":
			case "D":
				e.preventDefault();
				move("lane", 1);
				break;
			case "ArrowUp":
			case "w":
			case "W":
				e.preventDefault();
				move("row", -1);
				break;
			case "ArrowDown":
			case "s":
			case "S":
				e.preventDefault();
				move("row", 1);
				break;
			case "Enter":
				e.preventDefault();
				openCurrent();
				break;
		}
	}

	function onPointerDown(e: PointerEvent) {
		if (e.pointerType === "mouse") return;
		touchStart = { x: e.clientX, y: e.clientY, t: performance.now() };
	}

	/**
	 * 点击卡片：把屏幕坐标投成射线，打中哪张就切到哪张。
	 *
	 * 这里不引入 three 的 Raycaster 到组件层 —— 射线求交需要 scene 与 camera，
	 * 而两者都在异步加载的 engine 里。改为在 engine 就绪后把 raycaster
	 * 挂到 engine 句柄上（见 onMount），保持组件的同步渲染路径干净。
	 */
	function onCanvasClick(e: MouseEvent) {
		if (!engine) return;
		const slug = engine.pickAt?.(toNdc(e));
		if (slug) pickCard(slug);
	}

	/** 滚轮：竖向滚动切文章，按住 Shift 横向切分组 */
	function onWheel(e: WheelEvent) {
		e.preventDefault();
		if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
			move("lane", e.deltaX > 0 ? 1 : -1);
			return;
		}
		move("row", e.deltaY > 0 ? 1 : -1);
	}

	/** 悬停：命中卡片时轻微前推，鼠标滑过有反馈 */
	function onPointerMove(e: PointerEvent) {
		if (e.pointerType !== "mouse" || !engine) return;
		const slug = engine.pickAt?.(toNdc(e)) ?? null;
		array?.setHover(slug);
		if (canvasEl) canvasEl.style.cursor = slug ? "pointer" : "default";
	}

	function onPointerLeave() {
		array?.setHover(null);
		if (canvasEl) canvasEl.style.cursor = "default";
	}

	/** 屏幕坐标 → NDC（-1..1） */
	function toNdc(e: MouseEvent | PointerEvent) {
		const el = canvasEl;
		if (!el) return { x: 0, y: 0 };
		const rect = el.getBoundingClientRect();
		return {
			x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
			y: -((e.clientY - rect.top) / rect.height) * 2 + 1
		};
	}

	function onPointerUp(e: PointerEvent) {
		if (!touchStart) return;
		const dx = e.clientX - touchStart.x;
		const dy = e.clientY - touchStart.y;
		const dt = performance.now() - touchStart.t;
		touchStart = null;

		// 位移太小 = 点击，交给 click 处理器做拾取
		if (dt > 600 || Math.hypot(dx, dy) < 36) return;

		if (Math.abs(dx) > Math.abs(dy)) move("lane", dx < 0 ? 1 : -1);
		else move("row", dy < 0 ? 1 : -1);
	}

	// ── 生命周期 ────────────────────────────────────────────────────
	onMount(() => {
		let disposed = false;
		let raf = 0;
		let lastTick = 0;
		let reduceMotion = false;
		const cleanups: Array<() => void> = [];

		(async () => {
			if (!hostEl || !canvasEl) return;

			// 动态 import：three 只在客户端加载，SSR 阶段零成本
			const [{ createRhineEngine, prefersReducedMotion }, { createCardArray }] = await Promise.all([
				import("$lib/rhine/engine"),
				import("$lib/rhine/card-array")
			]);

			if (disposed || !hostEl || !canvasEl) return;

			try {
				engine = createRhineEngine({
					canvas: canvasEl,
					host: hostEl,
					maxPixelRatio: 2,
					fov: CAMERA_FOV,
					dark,
					onResize: () => {
						/*
						 * 容器尺寸变化会同时影响两件事：
						 *   ① 「整面墙能否看全」的判据（横向可见宽度变了）
						 *   ② 窄屏需要放大的 fov
						 * 所以必须重算取景（retargetCamera）再更新投影，
						 * 顺序反了就会用旧的取景宽度去推 fov。
						 */
						if (!engine) return;
						retargetCamera();
						updateProjection();
					}
				});
			} catch (err) {
				console.error("[rhine] WebGL 初始化失败", err);
				webglFailed = true;
				return;
			}

			array = createCardArray({
				scene: engine.scene,
				groups,
				palette: pickPalette(dark)
			});

			// 把拾取能力挂到引擎句柄上：组件层调用时不必再持有 scene/camera
			engine.pickAt = (ndc: { x: number; y: number }) =>
				array ? array.pickAt(engine.camera, ndc) : null;

			// 对外暴露一份只读快照，便于用无头浏览器核对取景数学。
			// 三维构图的问题在截图上只能看出「不对劲」，看不出是哪一步算错，
			// 有了这份快照就能直接把 fov / 距离 / 取景宽度 / 注视偏移打出来。
			engine.debugSnapshot = () => ({
				fov: +engine.camera.fov.toFixed(3),
				distance: +engine.cameraDistance.toFixed(3),
				framingHeight: +framingHeight().toFixed(3),
				framedWidth: +framedWidthNow().toFixed(3),
				aspect: +engine.size.width / engine.size.height,
				lanes: groups.length,
				aim: { x: +cam.x.toFixed(3), y: +cam.y.toFixed(3) },
				camPos: {
					x: +engine.camera.position.x.toFixed(3),
					y: +engine.camera.position.y.toFixed(3),
					z: +engine.camera.position.z.toFixed(3)
				},
				cell: { lane: cell.lane, row: cell.row }
			});

			retargetCamera();
			updateProjection();
			// 首帧不要动画，直接落到目标机位
			cam.x = cam.tx;
			cam.y = cam.ty;
			applyCameraPose();

			array.setSelection({ lane: 0, row: 0 }, null);
			ready = true;

			const reduce = prefersReducedMotion();
			reduceMotion = reduce;
			// 冻结引擎的时间（不做呼吸浮动/景深呼吸），但阵列的进场仍要走完
			engine.timeScale = reduce ? 0 : 1;

			const el = engine.renderer.domElement;
			el.addEventListener("pointerdown", onPointerDown);
			el.addEventListener("pointerup", onPointerUp);
			el.addEventListener("pointermove", onPointerMove);
			el.addEventListener("pointerleave", onPointerLeave);
			el.addEventListener("click", onCanvasClick);
			cleanups.push(() => {
				el.removeEventListener("pointerdown", onPointerDown);
				el.removeEventListener("pointerup", onPointerUp);
				el.removeEventListener("pointermove", onPointerMove);
				el.removeEventListener("pointerleave", onPointerLeave);
				el.removeEventListener("click", onCanvasClick);
			});

			// 逐帧：镜头插值 → 阵列更新（引擎内部已负责 render）
			engine.renderer.render(engine.scene, engine.camera);
		})();

		// 暴露给诊断脚本：拿真实数值而不是靠截图猜
		if (typeof window !== "undefined") {
			(window as any).__rhineDebug = () => engine?.debugSnapshot?.() ?? null;
			(window as any).__rhineCards = () => array?.inspect?.() ?? null;
			// 帧计数器：用于确认 rAF 循环真的在跑
			(window as any).__rhineFrames = 0;
			const countFrames = () => {
				(window as any).__rhineFrames = ((window as any).__rhineFrames ?? 0) + 1;
				requestAnimationFrame(countFrames);
			};
			requestAnimationFrame(countFrames);
		}

		// 独立于引擎的 rAF 驱动镜头与阵列 —— 这样即使引擎还没就绪也能跑
		function tick() {
			raf = requestAnimationFrame(tick);
			if (!engine || !array) return;
			// 帧时长用真实值而非写死 1/60：高刷屏上镜头插值才不会偏快
			const now = performance.now();
			const dt = lastTick === 0 ? 1 / 60 : Math.min((now - lastTick) / 1000, 0.1);
			lastTick = now;

			/*
			 * 「减弱动态效果」时引擎的 dt 为 0，于是进场动画永远算不到 t>=1，
			 * revealed 卡在 false，每帧都把 position.y 重置成 y-2.4 ——
			 * 表现为卡片被拆成上下两条带。这里给阵列一份独立的 dtScale，
			 * 让进场仍能推进，只是不做缓动。
			 */
			const dtScale = reduceMotion ? 0 : 1;
			void dtScale;

			// 指数插值，帧率无关
			const k = 1 - Math.pow(0.0015, dt);
			cam.x += (cam.tx - cam.x) * k;
			cam.y += (cam.ty - cam.y) * k;

			// 每帧按「墙心 + 注视偏移 + 固定偏轴角度」重算机位。
			// 注意不能只改 position.x/y —— 相机是偏轴的，z 必须一起走，
			// 否则平移过程中会斜着穿进档案墙里。
			applyCameraPose();

			// 进场动画照常推进（dt 用真实值），只是引擎那边的浮动被 timeScale 冻结
			array.update(dt, performance.now() / 1000);
		}
		raf = requestAnimationFrame(tick);

		cleanups.push(() => {
			cancelAnimationFrame(raf);
		});

		return () => {
			disposed = true;
			for (const fn of cleanups) fn();
			array?.dispose?.();
			engine?.dispose?.();
			array = null;
			engine = null;
		};
	});

	// 分组数据变化时重建阵列
	$effect(() => {
		const g = groups;
		if (!array || !ready) return;
		// 数据变了不是「首次进场」，直接落位 —— 否则每切一次主题/重渲染
		// 卡片都会重新从下方浮一遍，观感很吵
		array.rebuild(g, true);
		array.setSelection({ lane: unwrap(lane, g.length), row }, null);
		retargetCamera();
		updateProjection();
	});

	// 主题切换
	$effect(() => {
		const isDark = dark;
		if (!array || !ready) return;
		array.setPalette(pickPalette(isDark));
		// 光照必须跟着换档：同一套灯光不可能同时照亮近黑的深色卡面
		// 与接近纯白的亮色卡面（见 engine.ts 的 setLightIntensity 注释）
		engine?.setDark?.(isDark);
	});
</script>

<svelte:window on:keydown={onKeydown} />

<div class="rhine-array" bind:this={hostEl}>
	<canvas
		bind:this={canvasEl}
		class="rhine-array-canvas"
		role="application"
		aria-label="教程卡片阵列，使用左右方向键切换分组，上下方向键切换文章"
		onwheel={onWheel}
	></canvas>

	<!-- WebGL 不可用时的降级：保留可键盘导航的语义化列表 -->
	{#if webglFailed}
		<div class="rhine-array-fallback">
			<p class="rhine-label">WebGL unavailable</p>
			<p>当前环境不支持三维渲染，已切换为列表视图。</p>
			<ul>
				{#each groups as g (g.key)}
					<li>
						<strong>{g.label}</strong>
						<ul>
							{#each g.docs as d (d.slug)}
								<li><a href={`/docs/${d.slug}`}>{d.title}</a></li>
							{/each}
						</ul>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	<!-- 载入遮罩：等首帧渲染完成再揭开 -->
	<div class="rhine-array-veil" data-ready={ready}></div>

	<!-- ── HUD：浮在 3D 之上的二维信息层 ───────────────────────── -->
	<div class="rhine-hud">
		<!-- 顶部：当前分组指示 + 列切换箭头 -->
		<div class="rhine-hud-top">
			<button
				type="button"
				class="rhine-nav-btn"
				disabled={lane <= 0}
				aria-label="上一分组"
				onclick={() => move("lane", -1)}
			>
				<ChevronLeft size={16} />
			</button>

			<div class="rhine-hud-center">
				<span class="rhine-label">Section</span>
				<div class="rhine-hud-title">{currentGroup?.label ?? "—"}</div>
				<div class="rhine-hud-dots" aria-hidden="true">
					{#each groups as g, gi (g.key)}
						<span class="rhine-hud-dot" data-on={unwrap(lane, groups.length) === gi}></span>
					{/each}
				</div>
			</div>

			<button
				type="button"
				class="rhine-nav-btn"
				disabled={lane >= groups.length - 1}
				aria-label="下一分组"
				onclick={() => move("lane", 1)}
			>
				<ChevronRight size={16} />
			</button>
		</div>

		<!-- 底部：当前档案的摘要条 + 上下切换 -->
		<div class="rhine-hud-bottom">
			<button
				type="button"
				class="rhine-nav-btn"
				aria-label="上一篇"
				onclick={() => move("row", -1)}
			>
				<ChevronUp size={16} />
			</button>

			<div class="rhine-hud-detail">
				<div class="flex items-baseline gap-2">
					<span class="rhine-num">{String(currentDoc?.serial ?? 0).padStart(3, "0")}</span>
					<span class="rhine-hud-name">{currentDoc?.title ?? "—"}</span>
				</div>
				{#if currentDoc?.excerpt}
					<p class="rhine-hud-excerpt">{currentDoc.excerpt}</p>
				{/if}
			</div>

			<button
				type="button"
				class="rhine-nav-btn"
				aria-label="下一篇"
				onclick={() => move("row", 1)}
			>
				<ChevronDown size={16} />
			</button>
		</div>

		<!-- 右下角：打开提示 -->
		<button type="button" class="rhine-open" onclick={openCurrent} disabled={!currentDoc}>
			<CornerDownLeft size={13} />
			<span>打开档案</span>
			<kbd>Enter</kbd>
		</button>
	</div>
</div>

<style>
	.rhine-array {
		position: relative;
		width: 100%;
		height: clamp(460px, 68vh, 760px);
		border: 1px solid var(--rhine-line, currentColor);
		overflow: hidden;
		background:
			radial-gradient(circle at 50% 42%, color-mix(in srgb, var(--rhine-paper) 70%, transparent) 0%, transparent 68%),
			var(--rhine-field);
	}

	.rhine-array-canvas {
		display: block;
		width: 100%;
		height: 100%;
		touch-action: none;
	}

	/* 载入遮罩：从下往上揭开，呼应莱茵的启动序列 */
	.rhine-array-veil {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: var(--rhine-paper);
		clip-path: inset(0 0 0 0);
		transition: clip-path 0.9s cubic-bezier(0.16, 1, 0.3, 1) 0.1s;
	}
	.rhine-array-veil[data-ready="true"] {
		clip-path: inset(0 0 100% 0);
	}

	.rhine-hud {
		position: absolute;
		inset: 0;
		pointer-events: none;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		padding: 14px;
	}

	.rhine-hud-top,
	.rhine-hud-bottom {
		display: flex;
		align-items: center;
		gap: 12px;
		pointer-events: none;
	}

	.rhine-hud-top > * ,
	.rhine-hud-bottom > * {
		pointer-events: auto;
	}

	.rhine-hud-center {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
	}

	.rhine-hud-title {
		font-size: 15px;
		font-weight: 600;
		letter-spacing: -0.01em;
		text-align: center;
	}

	.rhine-hud-dots {
		display: flex;
		gap: 4px;
	}

	.rhine-hud-dot {
		width: 5px;
		height: 5px;
		background: var(--rhine-line);
		opacity: 0.5;
		transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
	}
	.rhine-hud-dot[data-on="true"] {
		background: var(--rhine-accent);
		opacity: 1;
		width: 14px;
	}

	.rhine-nav-btn {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		flex: none;
		border: 1px solid var(--rhine-line);
		background: color-mix(in srgb, var(--rhine-paper) 72%, transparent);
		color: var(--rhine-ink);
		backdrop-filter: blur(8px);
		transition: all 0.2s ease;
	}
	.rhine-nav-btn:hover:not(:disabled) {
		border-color: var(--rhine-accent);
		color: var(--rhine-accent);
	}
	.rhine-nav-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.rhine-hud-detail {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		background: color-mix(in srgb, var(--rhine-paper) 72%, transparent);
		border: 1px solid var(--rhine-line);
		backdrop-filter: blur(8px);
		padding: 8px 12px;
	}

	.rhine-hud-name {
		font-size: 13px;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.rhine-hud-excerpt {
		font-size: 11px;
		color: var(--rhine-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.rhine-open {
		position: absolute;
		right: 14px;
		bottom: 14px;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 7px 12px;
		font-size: 12px;
		border: 1px solid var(--rhine-accent);
		color: var(--rhine-accent);
		background: color-mix(in srgb, var(--rhine-paper) 80%, transparent);
		backdrop-filter: blur(8px);
		pointer-events: auto;
		transition: all 0.2s ease;
	}
	.rhine-open:hover:not(:disabled) {
		background: var(--rhine-accent);
		color: var(--rhine-paper);
	}
	.rhine-open:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}
	.rhine-open kbd {
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 10px;
		border: 1px solid currentColor;
		padding: 0 3px;
		opacity: 0.7;
	}

	.rhine-array-fallback {
		position: absolute;
		inset: 0;
		overflow: auto;
		padding: 16px;
		background: var(--rhine-paper);
		font-size: 13px;
	}
</style>
