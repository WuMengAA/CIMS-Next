/**
 * 莱茵档案阵列 —— 卡片实例池
 *
 * 只在视野附近维护卡片对象：分组维度保留 ±2 列，行维度只铺 VISIBLE_ROWS 行。
 * 卡片对象会被回收复用（换内容而不是换对象），避免切列切卡时反复
 * 创建 CanvasTexture 造成 GC 抖动 —— 一张 2048×1515 的画布约 12MB，
 * 每切一次分组就重建一遍会直接把内存打爆。
 */
import * as THREE from "three";
import {
	CAMERA_CENTER_THRESHOLD,
	CAMERA_ROW_BIAS,
	CARD_DEPTH,
	CARD_HEIGHT,
	CARD_WIDTH,
	COLUMN_SPACING,
	ROW_SPACING,
	VISIBLE_ROWS,
	cellToWorld,
	type ArchiveGroup,
	type ArchiveCell
} from "./archive";
import {
	createCardCanvas,
	repaintCard,
	type CardPalette,
	type CardTextureOptions
} from "./card-texture";

type CardRecord = {
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D;
	texture: THREE.Texture;
	mesh: THREE.Mesh;
	/** 当前贴的文档 slug，用于跳过无谓重绘 */
	slug: string | null;
	active: boolean;
	/** 目标 Y 偏移，用于错峰进场 */
	reveal: number;
};

/** 卡片的圆角比例（相对宽度），与纹理上的视觉保持一致 */
const CARD_RADIUS = 0.14;

/** 圆角卡片几何：用 Shape + ExtrudeGeometry 做出真正的圆角轮廓 */
function createCardGeometry() {
	const w = CARD_WIDTH;
	const h = CARD_HEIGHT;
	const r = CARD_RADIUS;
	const x = -w / 2;
	const y = -h / 2;

	const shape = new THREE.Shape();
	shape.moveTo(x + r, y);
	shape.lineTo(x + w - r, y);
	shape.quadraticCurveTo(x + w, y, x + w, y + r);
	shape.lineTo(x + w, y + h - r);
	shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
	shape.lineTo(x + r, y + h);
	shape.quadraticCurveTo(x, y + h, x, y + h - r);
	shape.lineTo(x, y + r);
	shape.quadraticCurveTo(x, y, x + r, y);

	const geometry = new THREE.ExtrudeGeometry(shape, {
		depth: CARD_DEPTH,
		bevelEnabled: true,
		bevelThickness: 0.012,
		bevelSize: 0.012,
		bevelSegments: 2,
		curveSegments: 8
	});
	// ExtrudeGeometry 从 z=0 向 +z 挤出，居中到 z=0
	geometry.translate(0, 0, -CARD_DEPTH / 2);
	geometry.computeBoundingSphere();
	return geometry;
}

export type CardArrayOptions = {
	scene: THREE.Scene;
	groups: ArchiveGroup[];
	palette: CardPalette;
	/** 卡面点击/选中回调 */
	onPick?: (docSlug: string) => void;
};

export type CardArray = {
	/** 按新的分组数据重建（分组数量或内容变化时调用；instant 跳过进场动画） */
	rebuild: (groups: ArchiveGroup[], instant?: boolean) => void;
	/** 切换选中格，重绘受影响卡片的选中态 */
	setSelection: (cell: ArchiveCell, previous: ArchiveCell | null) => void;
			// 逐帧更新：进场、呼吸、悬停
	update: (dt: number, elapsed: number) => void;
	/** 主题切换时换一套调色板并全量重绘 */
	setPalette: (palette: CardPalette) => void;
	/** 射线拾取：给屏幕 NDC 坐标，返回命中的文档 slug */
	pickAt: (camera: THREE.Camera, ndc: { x: number; y: number }) => string | null;
	/** 悬停高亮某张卡（传 null 清除） */
	setHover: (slug: string | null) => void;
	/** 当前是否已完成首屏进场 */
	isRevealed: () => boolean;
	/** 诊断快照：卡片的真实世界坐标，用于核对网格是否共面 */
	inspect: () => Array<{
		slug: string | null;
		lane: number;
		row: number;
		x: number;
		y: number;
		z: number;
		visible: boolean;
	}>;
	dispose: () => void;
};

export function createCardArray(options: CardArrayOptions): CardArray {
	const { scene } = options;
	let palette = options.palette;
	let groups = options.groups;

	const geometry = createCardGeometry();
	const cards: CardRecord[] = [];
	let selection: ArchiveCell = { lane: 0, row: 0 };
	let revealed = false;
	let revealTime = 0;

	// 每行一个独立的错峰基准，视觉上像刷卡机逐张吐卡
	const ROW_STAGGER = 0.06;

	function makeCard(): CardRecord {
		const canvasTarget = createCardCanvas();
		const material = new THREE.MeshStandardMaterial({
			map: canvasTarget.texture,
			transparent: false,
			roughness: 0.82,
			metalness: 0.02,
			side: THREE.FrontSide
		});
		const mesh = new THREE.Mesh(geometry, material);
		mesh.visible = false;
		// 卡片一律留在 z=0 的网格平面上，倾斜感全部交给相机的偏轴机位。
		// 一旦让卡片自己 rotation.y，面片之间就不再共面，会互相错开、被剪切。
		// 让射线检测更省：卡是扁平的，包围球足够
		mesh.frustumCulled = true;
		scene.add(mesh);
		return {
			...canvasTarget,
			mesh,
			slug: null,
			active: false,
			reveal: 0
		};
	}

	/** 取一张空闲卡，没有就新建 */
	function acquire(index: number): CardRecord {
		if (cards[index]) return cards[index];
		const card = makeCard();
		cards[index] = card;
		return card;
	}

	function paint(card: CardRecord, opts: CardTextureOptions) {
		repaintCard(card, opts);
	}

	/**
	 * 按新的分组数据重建（分组数量或内容变化时调用）。
	 *
	 * @param instant 跳过进场动画，直接落位。用于「数据变了但用户没在等动画」
	 *   的场景（主题切换后的重绘、SSR 后首帧），避免卡片停在半空。
	 */
	function rebuild(next: ArchiveGroup[], instant = false) {
		groups = next;

		// 计算需要多少个卡位：每个可见列 × 可见行
		const lanes = groups.map((_, i) => i);
		const perLane = VISIBLE_ROWS;
		let slot = 0;

		for (const lane of lanes) {
			const group = groups[lane];
			const rows = Math.min(group.docs.length, perLane);
			for (let row = 0; row < rows; row++) {
				const card = acquire(slot++);
				const doc = group.docs[row];
				const { x, y } = cellToWorld({ lane, row });

				card.mesh.visible = true;
				card.mesh.position.set(x, y, 0);
				card.mesh.userData = { lane, row, slug: doc.slug };

				if (card.slug !== doc.slug) {
					card.slug = doc.slug;
					card.active = false;
					paint(card, {
						content: {
							serial: doc.serial,
							title: doc.title,
							excerpt: doc.excerpt,
							group: doc.group,
							date: doc.date,
							category: doc.category
						},
						palette,
						active: false
					});
				}

				// 进场：从画面下方浮起 + 淡入
				card.reveal = instant ? 1 : 0;
				card.mesh.position.y = instant ? y : y - 2.4;
				card.mesh.scale.setScalar(instant ? 1 : 0.92);
			}
		}

		// 多余的卡位回收
		for (let i = slot; i < cards.length; i++) {
			cards[i].mesh.visible = false;
			cards[i].slug = null;
		}

		revealed = instant;
		revealTime = instant ? 1 : 0;
	}

	function setSelection(cell: ArchiveCell, previous: ArchiveCell | null) {
		selection = cell;
		for (const card of cards) {
			const data = card.mesh.userData as { lane?: number; row?: number } | undefined;
			if (!data || card.slug === null) continue;

			const isActive = data.lane === cell.lane && data.row === cell.row;
			const wasActive = previous ? data.lane === previous.lane && data.row === previous.row : false;
			if (isActive === card.active) continue;
			card.active = isActive;

			// 选中态变化需要重绘：从文档数据里找回内容
			const group = groups[data.lane ?? -1];
			const doc = group?.docs[data.row ?? -1];
			if (!doc) continue;
			paint(card, {
				content: {
					serial: doc.serial,
					title: doc.title,
					excerpt: doc.excerpt,
					group: doc.group,
					date: doc.date,
					category: doc.category
				},
				palette,
				active: isActive
			});
			void wasActive;
		}
	}

	/**
	 * 逐帧更新：进场、呼吸、悬停。
	 *
	 * @param dt 距上一帧的秒数
	 * @param elapsed 引擎累计秒数
	 * @param dtScale 容器被压扁时传进来的缩放（见下方说明）
	 */
	function update(dt: number, elapsed: number, dtScale = 1) {
		// timeScale 为 0（用户开启了「减弱动态效果」）时，进场动画会因为
		// t 永远算不到 1 而把 revealed 卡在 false，每帧都重置 position.y ——
		// 表现为卡片上下分离且随着「越像在动」越明显。这里直接快进到稳态。
		const d = dt * dtScale;
		if (!revealed) {
			// 首帧就可能要求直接落位：dtScale 为 0 表示「不要动画」
			revealTime += d;
			let allDone = true;

			for (const card of cards) {
				if (!card.mesh.visible) continue;
				const data = card.mesh.userData as { lane?: number; row?: number };
				const lane = data?.lane ?? 0;
				const row = data?.row ?? 0;
				// 按列 + 行的距离错峰：中心的先到，边上后到
				const delay = Math.abs(lane - selection.lane) * 0.05 + row * ROW_STAGGER;
				const t = d === 0 ? 1 : (revealTime - delay) / 0.42;

				if (t < 0) {
					allDone = false;
					continue;
				}
				if (t >= 1) {
					const { y } = cellToWorld({ lane, row });
					card.mesh.position.y = y;
					card.mesh.scale.setScalar(1);
					continue;
				}
				allDone = false;

				// easeOutCubic
				const e = 1 - Math.pow(1 - t, 3);
				const { y } = cellToWorld({ lane, row });
				card.mesh.position.y = y - 2.4 * (1 - e);
				card.mesh.scale.setScalar(0.92 + 0.08 * e);
			}

			if (allDone) revealed = true;
		}

		// 呼吸起伏：选中卡轻微前后浮动，是莱茵界面的招牌手感
		for (const card of cards) {
			if (!card.mesh.visible || card.slug === null) continue;
			const data = card.mesh.userData as { lane?: number; row?: number; slug?: string };
			const isActive = data?.lane === selection.lane && data?.row === selection.row;
			const isHover = hoverSlug !== null && data?.slug === hoverSlug && !isActive;

			if (isActive) {
				const bob = Math.sin(elapsed * 1.6) * 0.06;
				card.mesh.position.z += (0.22 + bob - card.mesh.position.z) * Math.min(1, d * 6);
			} else if (isHover) {
				card.mesh.position.z += (0.1 - card.mesh.position.z) * Math.min(1, d * 8);
			} else {
				card.mesh.position.z += (0 - card.mesh.position.z) * Math.min(1, d * 6);
			}
		}
	}

	function setPalette(next: CardPalette) {
		palette = next;
		for (const card of cards) {
			if (card.slug === null) continue;
			const data = card.mesh.userData as { lane?: number; row?: number };
			const group = groups[data?.lane ?? -1];
			const doc = group?.docs[data?.row ?? -1];
			if (!doc) continue;
			paint(card, {
				content: {
					serial: doc.serial,
					title: doc.title,
					excerpt: doc.excerpt,
					group: doc.group,
					date: doc.date,
					category: doc.category
				},
				palette,
				active: card.active
			});
		}
	}

	function dispose() {
		for (const card of cards) {
			scene.remove(card.mesh);
			(card.mesh.material as THREE.Material)?.dispose?.();
			card.texture.dispose();
			card.canvas.width = 0;
			card.canvas.height = 0;
		}
		cards.length = 0;
		geometry.dispose();
	}

	// ── 射线拾取 ──────────────────────────────────────────────────
	// Raycaster 复用一个实例；每帧 new 一个会产生大量短命对象
	const raycaster = new THREE.Raycaster();
	const ndcVec = new THREE.Vector2();

	function pickAt(camera: THREE.Camera, ndc: { x: number; y: number }): string | null {
		ndcVec.set(ndc.x, ndc.y);
		raycaster.setFromCamera(ndcVec, camera);
		const targets = cards.filter((c) => c.mesh.visible).map((c) => c.mesh);
		const hits = raycaster.intersectObjects(targets, false);
		if (hits.length === 0) return null;
		const slug = (hits[0].object.userData as { slug?: string }).slug ?? null;
		return slug;
	}

	/** 悬停高亮：把非选中卡的正面轻微抬起，鼠标滑过有响应 */
	let hoverSlug: string | null = null;
	function setHover(slug: string | null) {
		if (hoverSlug === slug) return;
		hoverSlug = slug;
	}

	/** 诊断用：把每张卡的网格坐标与应有坐标一起打出来，便于核对共面性 */
	function inspect() {
		return cards
			.filter((c) => c.mesh.visible)
			.map((c) => {
				const d = c.mesh.userData as { lane?: number; row?: number; slug?: string };
				return {
					slug: d?.slug ?? null,
					lane: d?.lane ?? -1,
					row: d?.row ?? -1,
					x: c.mesh.position.x,
					y: c.mesh.position.y,
					z: c.mesh.position.z,
					visible: c.mesh.visible
				};
			});
	}

	rebuild(groups);

	return {
		rebuild,
		setSelection,
		update,
		setPalette,
		pickAt,
		setHover,
		isRevealed: () => revealed,
		inspect,
		dispose
	};
}

/** 便捷：从分组数据里取某格对应的文档，越界返回 undefined */
export function docAt(groups: ArchiveGroup[], cell: ArchiveCell) {
	const group = groups[cell.lane];
	if (!group) return undefined;
	return group.docs[cell.row];
}

/**
 * 相机到目标格的推荐机位。距离与偏移量的取值理由见 archive.ts 的常量注释。
 */
export function cameraPoseFor(cell: ArchiveCell, rowCount: number) {
	const { x, y } = cellToWorld(cell);
	const centered = rowCount <= CAMERA_CENTER_THRESHOLD;
	return {
		x,
		y: centered ? y - ((rowCount - 1) * ROW_SPACING) / 2 : y - CAMERA_ROW_BIAS,
		rowStep: ROW_SPACING,
		centered
	};
}
