/**
 * 可视化界面编辑器的数据模型。
 *
 * 一份「界面布局」(LayoutDoc) 由画布尺寸 + 一组卡片组件 (CardModel) 组成。
 * 每张卡片有：类型、绝对定位 (x/y)、尺寸 (w/h)、层级 (z)、业务属性 (props)、视觉样式 (style)。
 * 编辑器只认这一套 JSON —— 导入/导出、localStorage 草稿、后续接后端都围绕它。
 */

export type CardType =
	| "heading"
	| "text"
	| "image"
	| "button"
	| "card"
	| "divider"
	| "list";

/** 通用视觉样式：所有卡片类型共享，在属性面板「样式」区统一编辑。 */
export interface CardStyle {
	/** 背景色，CSS 颜色值；为空表示透明（沿用画布底色）。 */
	background?: string;
	/** 文字颜色，CSS 颜色值。 */
	color?: string;
	/** 圆角，px。 */
	borderRadius?: number;
	/** 内边距，px。 */
	padding?: number;
	/** 边框宽度，px（0 = 无边框）。 */
	borderWidth?: number;
	/** 边框颜色。 */
	borderColor?: string;
	/** 边框样式。 */
	borderStyle?: "solid" | "dashed" | "none";
	/** 字号，px。 */
	fontSize?: number;
	/** 水平对齐。 */
	textAlign?: "left" | "center" | "right";
	/** 不透明度，0~1。 */
	opacity?: number;
	/** 字重。 */
	fontWeight?: number;
	/** 是否加投影。 */
	boxShadow?: boolean;
}

/** 一张卡片组件。 */
export interface CardModel {
	id: string;
	type: CardType;
	/** 绝对定位（相对画布左上角），px。 */
	x: number;
	y: number;
	/** 尺寸，px。 */
	w: number;
	h: number;
	/** 层级，越大越靠上。 */
	z: number;
	/** 业务属性（按类型不同而不同）。 */
	props: Record<string, unknown>;
	/** 视觉样式。 */
	style: CardStyle;
}

/** 画布（实时预览区）状态。 */
export interface CanvasState {
	width: number;
	height: number;
	/** 画布底色。 */
	background: string;
}

/** 一份完整的界面布局配置。 */
export interface LayoutDoc {
	version: number;
	/** 布局名称（导出文件名、草稿标识用）。 */
	name: string;
	canvas: CanvasState;
	cards: CardModel[];
}

/** 稳定序列化：导出/草稿都用它，字段顺序固定、可读。 */
export function serializeDoc(doc: LayoutDoc): string {
	return JSON.stringify(doc, null, 2);
}
