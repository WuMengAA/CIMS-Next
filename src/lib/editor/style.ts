import type { CardStyle } from "./types";

/** 把 CardStyle 转成内联 CSS 字符串（供 CardView 渲染与属性面板预览共用）。 */
export function cardStyleToCss(s: CardStyle): string {
	const p: string[] = [];
	if (s.background) p.push(`background:${s.background}`);
	if (s.color) p.push(`color:${s.color}`);
	if (s.borderRadius != null) p.push(`border-radius:${s.borderRadius}px`);
	if (s.padding != null) p.push(`padding:${s.padding}px`);
	if (s.borderWidth != null && s.borderWidth > 0) {
		p.push(`border:${s.borderWidth}px ${s.borderStyle ?? "solid"} ${s.borderColor ?? "#333"}`);
	}
	if (s.fontSize != null) p.push(`font-size:${s.fontSize}px`);
	if (s.textAlign) p.push(`text-align:${s.textAlign}`);
	if (s.fontWeight != null) p.push(`font-weight:${s.fontWeight}`);
	if (s.opacity != null) p.push(`opacity:${s.opacity}`);
	if (s.boxShadow) p.push(`box-shadow:0 6px 24px rgba(0,0,0,0.35)`);
	return p.join(";");
}

/** 通用样式字段定义：属性面板「样式」区按此渲染，顺序即展示顺序。 */
export interface StyleFieldDef {
	key: keyof CardStyle;
	label: string;
	control: "color" | "number" | "select" | "toggle";
	min?: number;
	max?: number;
	step?: number;
	options?: { value: string; label: string }[];
}

export const STYLE_FIELDS: StyleFieldDef[] = [
	{ key: "background", label: "背景色", control: "color" },
	{ key: "color", label: "文字色", control: "color" },
	{ key: "fontSize", label: "字号", control: "number", min: 8, max: 96, step: 1 },
	{ key: "fontWeight", label: "字重", control: "number", min: 100, max: 900, step: 100 },
	{ key: "textAlign", label: "对齐", control: "select", options: [
		{ value: "left", label: "左" },
		{ value: "center", label: "中" },
		{ value: "right", label: "右" }
	] },
	{ key: "borderRadius", label: "圆角", control: "number", min: 0, max: 80, step: 1 },
	{ key: "padding", label: "内边距", control: "number", min: 0, max: 80, step: 1 },
	{ key: "borderWidth", label: "边框宽", control: "number", min: 0, max: 20, step: 1 },
	{ key: "borderColor", label: "边框色", control: "color" },
	{ key: "borderStyle", label: "边框样式", control: "select", options: [
		{ value: "solid", label: "实线" },
		{ value: "dashed", label: "虚线" },
		{ value: "none", label: "无" }
	] },
	{ key: "opacity", label: "不透明度", control: "number", min: 0.1, max: 1, step: 0.05 },
	{ key: "boxShadow", label: "投影", control: "toggle" }
];
