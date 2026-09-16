/**
 * 页面模板库 —— 「快捷创建」的素材来源。
 *
 * 为什么单独成文件而不是写死在编辑器里：模板是运营资产，会持续增补
 * （新落地页形态、新美术版式）；把它与编辑器逻辑分离，加模板只需在这里加一项，
 * 编辑器、侧边选择器、预览全部自动生效。
 *
 * 每个模板给出：骨架正文（markdown）+ 推荐的布局/版式字段。
 * 注意模板正文里刻意留了 {{占位}} 或示例内容 —— 空白画布最劝退，有骨架才有行动。
 */

export interface PageTemplate {
	/** 唯一标识（也是前端选择器 key）。 */
	id: string;
	/** 显示名。 */
	name: string;
	/** 一句话说明，告诉用户"这个模板适合干什么"。 */
	desc: string;
	/** 图标名（对应编辑器里的映射表，避免此文件依赖图标库）。 */
	icon: string;
	/** 预填正文。 */
	body: string;
	/** 推荐布局字段（创建后仍可改）。 */
	layout: "narrow" | "standard" | "wide" | "full";
	hero: "none" | "plain" | "banner";
	aside: boolean;
	toc: boolean;
	/** 预设分类。 */
	category?: string;
}

export const PAGE_TEMPLATES: PageTemplate[] = [
	{
		id: "blank",
		name: "空白页",
		desc: "从零开始，只有标题和正文区",
		icon: "file",
		category: "通用",
		layout: "standard",
		hero: "plain",
		aside: false,
		toc: false,
		body: "在这里开始写作。\n\n## 小标题\n\n正文内容……\n"
	},
	{
		id: "about",
		name: "关于页",
		desc: "站点/团队介绍，含简介与联系区",
		icon: "user",
		category: "通用",
		layout: "narrow",
		hero: "plain",
		aside: false,
		toc: true,
		body: `## 我们是谁

用一段话介绍这里是什么地方、由谁在做、想做成什么样。

## 我们在做什么

- **星璃音乐** —— 本地音乐播放器，算法与小模型驱动的"会思考"的播放体验
- **星璃知识库** —— 沉淀与分享的结构化内容
- **本站** —— 记录与展示的窗口

## 联系我们

- GitHub：[@yourname](https://github.com/yourname)
- 邮箱：hello@example.com

> 欢迎通过[反馈页](/feedback)告诉我们你的想法。
`
	},
	{
		id: "landing",
		name: "落地页",
		desc: "宽版心 + 大页头，适合功能发布与推广",
		icon: "rocket",
		category: "推广",
		layout: "wide",
		hero: "banner",
		aside: false,
		toc: false,
		body: `## 一句话说清它解决什么问题

用两三行讲明白：谁需要它、它好在哪、现在就能用什么。

### 核心能力

| 能力 | 说明 |
| --- | --- |
| 本地优先 | 文件在你自己硬盘上，无需上传 |
| 智能策展 | 小模型理解你的收听习惯 |
| 沉浸视觉 | 体素世界背景随音乐起伏 |

### 现在开始

[前往下载](#) · [查看文档](/docs) · [加入社区](/forum)
`
	},
	{
		id: "art",
		name: "美术设计页",
		desc: "全宽无框版心，适合视觉作品与画廊",
		icon: "palette",
		category: "美术",
		layout: "full",
		hero: "none",
		aside: false,
		toc: false,
		body: `<!-- 全宽版心：图片会铺满可视区，适合作品集与视觉展示 -->

![作品标题](/uploads/your-image.png)

## 创作说明

写下这幅作品的背景、用色思路、想传达的情绪。

> 材质：数字绘画 · 尺寸：3840×2160 · 年份：2026
`
	},
	{
		id: "doc",
		name: "说明文档",
		desc: "带目录侧栏的长文，适合规范与手册",
		icon: "book",
		category: "文档",
		layout: "standard",
		hero: "plain",
		aside: true,
		toc: true,
		body: `## 适用范围

本页说明……，适用于……。

## 快速开始

1. 第一步
2. 第二步
3. 第三步

## 常见问题

### 问题一

解答……

### 问题二

解答……
`
	},
	{
		id: "links",
		name: "友链说明",
		desc: "友链申请条件与格式说明",
		icon: "link",
		category: "通用",
		layout: "narrow",
		hero: "plain",
		aside: false,
		toc: false,
		body: `## 申请条件

- 站点内容原创、可正常访问
- 已在贵站添加本站链接
- 无违法违规内容

## 申请格式

\`\`\`
站点名称：
站点地址：
站点简介：
头像地址：
\`\`\`

提交后我们会在 3 个工作日内处理，结果可在[友链申请](/links)页查看。
`
	},
	{
		id: "notice",
		name: "公告页",
		desc: "窄版心，适合条款与声明类内容",
		icon: "megaphone",
		category: "通用",
		layout: "narrow",
		hero: "plain",
		aside: false,
		toc: false,
		body: `## 声明

本页内容最后更新于 {{日期}}。

## 具体条款

1. 条款一
2. 条款二

如有疑问请联系我们。
`
	}
];

/** 按 id 取模板（编辑器初始化用）。 */
export function getTemplate(id: string): PageTemplate | undefined {
	return PAGE_TEMPLATES.find((t) => t.id === id);
}

/** 版心预设 —— 供编辑器下拉与前台渲染共用同一套取值，避免两边定义漂移。 */
export const LAYOUT_PRESETS = [
	{ value: "narrow", label: "窄版心", desc: "适合长文阅读（约 68 字/行）", maxWidth: "680px" },
	{ value: "standard", label: "标准", desc: "默认阅读宽度", maxWidth: "820px" },
	{ value: "wide", label: "宽版心", desc: "适合图文混排与表格", maxWidth: "1080px" },
	{ value: "full", label: "全宽", desc: "铺满可视区，适合视觉作品", maxWidth: "100%" }
] as const;

export type LayoutValue = (typeof LAYOUT_PRESETS)[number]["value"];
