/**
 * 莱茵档案阵列 —— 几何与导航
 *
 * 数据模型借用了 RhineLabUI 的「无限滚动泳道」思路，但为文档库做了简化：
 *   莱茵原版是 9 条泳道 × 32 行的循环池（160 个实例承载 40 份档案，
 *   靠 nearestOccurrence 把同一份档案铺满视野）。文档库的条目数量少且
 *   分组是天然的一级结构，所以这里改成：
 *
 *     X 轴 = 分组（列）      —— 左右方向键切分组
 *     Y 轴 = 组内文章（行）  —— 上下方向键切文章
 *
 *   与用户选定的交互语义完全一致，且不需要循环池，几何关系可直接推演。
 */

/** 卡片宽高。与 RhineLabUI DESIGN.md 的 5 × 3.7 保持一致 */
export const CARD_WIDTH = 5;
export const CARD_HEIGHT = 3.7;
/** 列中心距。卡片本身 5 宽，留 0.2 视觉缝 */
export const COLUMN_SPACING = 5.2;
/** 行距。卡片 3.7 高 + 0.62 间距 = 4.32 的垂直步进 */
export const ROW_SPACING = 4.32;
/** 卡片厚度 */
export const CARD_DEPTH = 0.08;

/** 可见行数上限：纵向视野内最多同时铺多少张卡（超出部分靠滚动进入） */
export const VISIBLE_ROWS = 7;

export type ArchiveGroup = {
	key: string;
	label: string;
	index: number;
	docs: ArchiveDoc[];
};

export type ArchiveDoc = {
	slug: string;
	title: string;
	excerpt?: string;
	category?: string;
	date?: string;
	group: string;
	groupIndex: number;
	/** 组内序号，从 0 起 */
	row: number;
	/** 全册连续编号，从 1 起 */
	serial: number;
	href: string;
};

/** 把后端给的扁平文档列表切成「分组 → 文章」两级结构 */
export function buildArchive(raw: any[]): ArchiveGroup[] {
	const map = new Map<string, any[]>();
	for (const doc of raw) {
		const key = doc.folder || doc.category || "未分类";
		if (!map.has(key)) map.set(key, []);
		map.get(key)!.push(doc);
	}

	const groups: ArchiveGroup[] = [];
	let serial = 0;
	let gi = 0;

	for (const [key, docs] of map) {
		const group: ArchiveGroup = { key, label: key, index: gi, docs: [] };
		docs.forEach((doc, row) => {
			serial += 1;
			group.docs.push({
				slug: doc.slug,
				title: doc.title ?? "(无标题)",
				excerpt: doc.excerpt,
				category: doc.category,
				date: doc.date,
				group: key,
				groupIndex: gi,
				row,
				serial,
				href: `/docs/${doc.slug}`
			});
		});
		groups.push(group);
		gi += 1;
	}

	return groups;
}

export type ArchiveCell = { lane: number; row: number };

/**
 * 单元坐标 → 世界坐标。
 * lane 是分组索引（可为负，表示左侧来的方向），row 是组内行索引。
 * 纵向以视野中心为原点：行 0 在顶部，向下排。
 */
export function cellToWorld(cell: ArchiveCell): { x: number; y: number } {
	return {
		x: cell.lane * COLUMN_SPACING,
		y: -cell.row * ROW_SPACING
	};
}

/**
 * 把「当前选中的卡片」折算成镜头目标点，
 * 让被选中的卡片落在视野中央偏上（下方留出后续卡片的暗示空间）。
 */
export function cellToCameraTarget(cell: ArchiveCell, group: ArchiveGroup | undefined) {
	const { x, y } = cellToWorld(cell);
	// 组内条目少时，把整列上移一点，避免内容全挤在画面下半部
	const rows = group?.docs.length ?? 1;
	const bias = rows <= 3 ? y * 0.35 : 0;
	return { x, y: y + bias };
}

/** 把 lane 夹在合法分组范围内，越界时返回 null（表示不动） */
export function clampLane(lane: number, groupCount: number): number | null {
	if (groupCount === 0) return null;
	if (lane < 0 || lane >= groupCount) return null;
	return lane;
}

/** 把 row 在组内循环（上下到底后回到另一端，符合「无限卷轴」的直觉） */
export function wrapRow(row: number, count: number): number {
	if (count <= 0) return 0;
	return ((row % count) + count) % count;
}

/**
 * 把可能越界的 lane 折回合法范围。
 *
 * 为什么允许 lane 越界：切换分组时若在边界处立即夹住，过渡动画会突然
 * 反向（本该继续往左滑，结果画面往右弹）。让 lane 暂时走到 -1 / N，
 * 视觉上是「滑出去撞墙」，下一帧再折回来，手感自然得多。
 */
export function unwrap(lane: number, count: number): number {
	if (count <= 0) return 0;
	return Math.min(Math.max(lane, 0), count - 1);
}

/** 分组列在视野内的可见性判据，用于剔除不可见卡片的渲染与纹理生成 */
export function isLaneNearby(lane: number, centerLane: number, radius = 2): boolean {
	return Math.abs(lane - centerLane) <= radius;
}

/**
 * 相机距离的单一真源。
 *
 * ⚠️ 这里不能照抄 RhineLabUI 的 7.33 取景高度 —— 那是它**进场特写**的构图，
 * 视野里只有一两张卡。
 *
 * 但也不能一味求大：文档库的分组数很少（当前 3 组），若按「装下 7 列」取景，
 * 阵列只占画面中间一小条，两侧全是空墙，反而不像阵列。
 *
 * 所以取景高度按**实际分组数**动态决定，见 computeFramingHeight()。
 * 下面的常量只是缺省值与上下限。
 */
export const CAMERA_FOV = 18;
export const FRAMING_MIN = 9;
export const FRAMING_MAX = 24;

/** 取景换算的基准宽高比：一切「横向能装下几列」的判据都以它为准 */
export const REF_ASPECT = 16 / 9;

/**
 * 窄屏放大的 fov 上限。
 *
 * 竖屏手机卡片区宽高比可能低到 0.5，按 base/aspect 算出的 fov 会到 62°，
 * 广角畸变+卡片被斜切到读不出。夹在 30° 以内，剩下的缺口交给
 * 「切列时镜头横移」去补 —— 看不清是硬伤，看不到可以滑动。
 */
export const MAX_ASPECT_FOV = 30;

/**
 * 整墙可见时，实际取景宽度相对墙宽的缩放。
 *
 * 1.0 = 最外侧列的边框紧贴画布边缘，会被裁掉一点，且没有呼吸感。
 * 但 1.0 也**不能小**：实测容器 aspect 2.08、墙宽 15.6 时若把取景宽度
 * 放大到墙宽的 1.2 倍，每侧就会留出 176px 空墙，而卡片只有 294px ——
 * 视觉上像「墙缩在中间一小块」，阵列感全无。
 *
 * 0.98 让最外侧列极轻微地「出血」（裁掉约 1% 边框），
 * 换来的是一面延伸到画面之外的墙。这是刻意的取舍：**宁可裁边，不要空墙**。
 */
export const WALL_FILL = 0.98;

/**
 * 取景高度相对「刚好装下这些列」的留白系数。
 *
 * 1.16 是实测出来的：1.0 = 最外侧列紧贴画布边缘、边框会被裁掉；
 * 1.06 仍偏挤；1.28 则整面墙缩在画面中央一小块（第一版就是栽在这）。
 * 1.16 时最外侧列离边缘约 8% 画宽，四周留白均匀，矩阵感最强。
 */
export const FRAMING_PADDING = 1.16;

/**
 * 竖向至少要看到几行的「世界高度」。
 *
 * 这个值决定整面墙的缩放基准 —— 它与「按宽度取景」谁大谁生效。
 * 3 行是实测的下限：少于 3 行时上下没有「还有内容」的暗示，
 * 多于 4 行则卡片被推得太小、标题读不清。
 */
const FRAMING_MIN_ROWS = 2.8;

/**
 * 按实际阵列规模算出竖向取景高度。
 *
 * 横向需要装下 laneCount 列，折算到竖向：
 *   宽度需求 = laneCount * COLUMN_SPACING
 *   换算高度 = 宽度需求 / REF_ASPECT
 * 再乘留白系数，让阵列四周有呼吸而不是贴着画布边缘。
 *
 * ⚠️ 这里必须用固定的 REF_ASPECT(16:9) 而不是容器的实时宽高比。
 * 否则会出现正反馈：取景高度变大 → 判定「横向能装下更多列」→
 * 取景高度被进一步放大……最终整面墙缩成画面中央一小块。
 */
export function computeFramingHeight(laneCount: number): number {
	const lanes = Math.max(1, laneCount);
	const widthForLanes = lanes * COLUMN_SPACING * FRAMING_PADDING;
	const heightFromWidth = widthForLanes / REF_ASPECT;
	// 竖向至少要露出 FRAMING_MIN_ROWS 行，否则组内文章多了就成一条竖线
	const minHeight = ROW_SPACING * FRAMING_MIN_ROWS;
	const raw = Math.max(heightFromWidth, minHeight);
	return Math.min(Math.max(raw, FRAMING_MIN), FRAMING_MAX);
}

/** 由 fov 与取景高度反推的相机距离 */
export function distanceForFraming(fovDeg: number, framingHeight: number) {
	return framingHeight / 2 / Math.tan((fovDeg * Math.PI) / 360);
}

/**
 * 镜头机位的偏轴角度 —— 莱茵构图的灵魂，但必须克制。
 *
 * 实测教训（两轮）：
 *
 * 第一轮照抄参考的 yaw 59° / elevation 19°，结果是灾难 ——
 * 卡片沿着一条斜线向远处收缩，看着像「走廊」而不是「墙」，且远端卡片
 * 小到不可读。参考实现能承受 59° 是因为它同时满足两个条件：
 *   · 相机距离 140（我们的 1/6），透视压缩被拉平
 *   · 档案墙有 9 条泳道纵深（我们只有 3 个分组）
 *
 * 第二轮降到 yaw 22° / elevation 9° 仍不对：这个角度下相邻两列的
 * 距离差 Δz = 5.2·sin22° ≈ 1.95，在 32.7 的距离上造成约 6% 的缩放差；
 * 而 6% 的缩放差作用在「屏幕上 4.32 的行高」上会被放大成明显的
 * 视觉错位 —— 看起来就像整排卡片被拆成上下两条互不相干的带子。
 *
 * 第三轮取 yaw 8° / elevation 6°：仍然看得出是从斜上方看的一面墙
 * （有厚度、有纵深、卡片有轻微梯形），但 Δz 只有 0.72，
 * 缩放差降到 2.2% 以内，行列关系老老实实地呈现出来。
 *
 * 结论：我们的阵列又薄又浅，偏轴角度必须比参考小一个数量级。
 */
export const CAMERA_YAW_DEG = 8;
export const CAMERA_ELEVATION_DEG = 6;

/**
 * 选中卡在画面里的纵向落点补偿（世界单位）。
 *
 * 选中卡不放在画面正中，而是偏上约 1/3 处：
 *   · 下方露出的后续卡片暗示「还有内容，可以继续往下」
 *   · 底部 HUD 信息条占据下沿，居中会被压住
 *
 * 世界坐标 y 向下为负，所以「让卡片偏上」= 把镜头再往下压。
 */
export const CAMERA_ROW_BIAS = 0.95;

/** 组内条目少于此数时整列都在视野内，改为垂直居中该列 */
export const CAMERA_CENTER_THRESHOLD = 4;

/**
 * 俯角会让世界 y 在屏幕上被压缩，卡片间距实际观感变窄。
 * 用 cos(elevation) 把纵向偏移换算回屏幕等价的量，避免不同机位下
 * 「偏上 1/3」的观感时大时小。
 */
export const CAMERA_Y_VIEW_SCALE = Math.cos((CAMERA_ELEVATION_DEG * Math.PI) / 180);

export type NavigationResult = {
	cell: ArchiveCell;
	/** 是否真的产生了位移，false 时上层应跳过动画 */
	moved: boolean;
	/** lane 变化触发的整列结构重组 */
	laneChanged: boolean;
	/** 是否为循环回卷（从末条跳回首条），用于选择不同的过渡动画 */
	wrapped: boolean;
};

/** 纯函数导航：给定当前格与输入方向，算出目标格 */
export function navigate(
	current: ArchiveCell,
	groups: ArchiveGroup[],
	axis: "lane" | "row",
	direction: number
): NavigationResult {
	if (groups.length === 0) {
		return { cell: current, moved: false, laneChanged: false, wrapped: false };
	}

	if (axis === "lane") {
		const next = clampLane(current.lane + direction, groups.length);
		if (next === null) {
			return { cell: current, moved: false, laneChanged: false, wrapped: false };
		}
		const rows = groups[next].docs.length;
		return {
			cell: { lane: next, row: wrapRow(current.row, rows) },
			moved: true,
			laneChanged: true,
			wrapped: false
		};
	}

	const group = groups[current.lane];
	if (!group || group.docs.length === 0) {
		return { cell: current, moved: false, laneChanged: false, wrapped: false };
	}
	const raw = current.row + direction;
	const next = wrapRow(raw, group.docs.length);
	return {
		cell: { lane: current.lane, row: next },
		moved: next !== current.row,
		laneChanged: false,
		wrapped: raw < 0 || raw >= group.docs.length
	};
}
