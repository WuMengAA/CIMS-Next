import type { CardType, CardStyle } from "./types";

/** 属性面板里「业务属性」字段的控件类型。 */
export interface FieldDef {
	key: string;
	label: string;
	control: "text" | "textarea" | "number" | "color" | "url" | "select" | "list";
	options?: { value: string; label: string }[];
	min?: number;
	max?: number;
	placeholder?: string;
}

/** 一种卡片类型的定义：决定了组件面板里的入口、默认外观与可编辑字段。 */
export interface CardTypeDef {
	type: CardType;
	/** 组件面板显示名。 */
	label: string;
	/** lucide 图标名（组件面板用）。 */
	icon: string;
	/** 新建时的默认尺寸。 */
	defaultSize: { w: number; h: number };
	/** 新建时的默认业务属性。 */
	defaultProps: Record<string, unknown>;
	/** 新建时的默认样式（与 STYLE_FIELDS 对齐，只给有意义的项）。 */
	defaultStyle: Partial<CardStyle>;
	/** 业务属性字段（属性面板「内容」区渲染）。 */
	fields: FieldDef[];
}

/**
 * 卡片类型注册表。新增一种卡片 = 在这里加一项 + 在 CardView 的渲染分支里加一段，
 * 组件面板、属性面板、图层列表全部自动生效（和 page-templates 同样的设计意图）。
 */
export const CARD_TYPES: CardTypeDef[] = [
	{
		type: "heading",
		label: "标题",
		icon: "Heading",
		defaultSize: { w: 360, h: 64 },
		defaultProps: { text: "标题文字", level: "h2" },
		defaultStyle: { fontSize: 28, fontWeight: 700, textAlign: "left", color: "" },
		fields: [
			{ key: "text", label: "文字", control: "text", placeholder: "标题内容" },
			{
				key: "level",
				label: "级别",
				control: "select",
				options: [
					{ value: "h1", label: "H1" },
					{ value: "h2", label: "H2" },
					{ value: "h3", label: "H3" },
					{ value: "h4", label: "H4" }
				]
			}
		]
	},
	{
		type: "text",
		label: "文本",
		icon: "Type",
		defaultSize: { w: 360, h: 120 },
		defaultProps: { content: "在这里输入正文内容，支持多行。双击卡片可在右侧属性面板编辑。" },
		defaultStyle: { fontSize: 15, textAlign: "left", color: "" },
		fields: [{ key: "content", label: "正文", control: "textarea", placeholder: "正文内容" }]
	},
	{
		type: "image",
		label: "图片",
		icon: "Image",
		defaultSize: { w: 280, h: 200 },
		defaultProps: { src: "", alt: "图片说明", objectFit: "cover" },
		defaultStyle: { borderRadius: 8, background: "#222222" },
		fields: [
			{ key: "src", label: "图片地址", control: "url", placeholder: "https:// 或 /uploads/xxx.png" },
			{ key: "alt", label: "替代文字", control: "text" },
			{
				key: "objectFit",
				label: "填充方式",
				control: "select",
				options: [
					{ value: "cover", label: "裁切填满" },
					{ value: "contain", label: "完整显示" },
					{ value: "fill", label: "拉伸" }
				]
			}
		]
	},
	{
		type: "button",
		label: "按钮",
		icon: "MousePointerClick",
		defaultSize: { w: 160, h: 44 },
		defaultProps: { label: "按钮", href: "#", variant: "primary" },
		defaultStyle: { borderRadius: 8 },
		fields: [
			{ key: "label", label: "文字", control: "text" },
			{ key: "href", label: "链接", control: "url", placeholder: "https:// 或 /path" },
			{
				key: "variant",
				label: "样式",
				control: "select",
				options: [
					{ value: "primary", label: "主按钮" },
					{ value: "secondary", label: "次按钮" },
					{ value: "outline", label: "描边" }
				]
			}
		]
	},
	{
		type: "card",
		label: "卡片容器",
		icon: "Square",
		defaultSize: { w: 300, h: 180 },
		defaultProps: { title: "卡片标题" },
		defaultStyle: {
			background: "#1f1f1d",
			borderRadius: 12,
			padding: 16,
			borderWidth: 1,
			borderColor: "#333333",
			borderStyle: "solid",
			boxShadow: true
		},
		fields: [{ key: "title", label: "标题", control: "text" }]
	},
	{
		type: "divider",
		label: "分割线",
		icon: "Minus",
		defaultSize: { w: 360, h: 24 },
		defaultProps: { thickness: 2, color: "#444444" },
		defaultStyle: {},
		fields: [
			{ key: "thickness", label: "线宽", control: "number", min: 1, max: 12, step: 1 },
			{ key: "color", label: "颜色", control: "color" }
		]
	},
	{
		type: "list",
		label: "列表",
		icon: "List",
		defaultSize: { w: 300, h: 160 },
		defaultProps: { items: "项目一\n项目二\n项目三" },
		defaultStyle: { fontSize: 15, textAlign: "left", color: "" },
		fields: [{ key: "items", label: "条目（每行一个）", control: "list", placeholder: "每行一个" }]
	}
];

/** 按类型取定义。 */
export function getCardType(type: CardType): CardTypeDef {
	const def = CARD_TYPES.find((t) => t.type === type);
	if (!def) throw new Error(`未知卡片类型: ${type}`);
	return def;
}
