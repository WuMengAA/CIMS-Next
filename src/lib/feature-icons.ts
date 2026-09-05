import {
	FileCode2,
	Palette,
	ShieldCheck,
	Globe,
	Rocket,
	Sparkles,
	Zap,
	BookOpen,
	Layers,
	Wrench,
	Cpu,
	Boxes
} from "@lucide/svelte";

/**
 * 首页「特性卡」可选图标池。
 * 后台站点设置以下拉方式选择，前台按名称解析；名称无效时回退到 Sparkles，
 * 避免出现图标缺失导致的空白方块。
 */
export const FEATURE_ICONS = {
	"file-code": FileCode2,
	palette: Palette,
	"shield-check": ShieldCheck,
	globe: Globe,
	rocket: Rocket,
	sparkles: Sparkles,
	zap: Zap,
	"book-open": BookOpen,
	layers: Layers,
	wrench: Wrench,
	cpu: Cpu,
	boxes: Boxes
} as const;

export type FeatureIconName = keyof typeof FEATURE_ICONS;

export const FEATURE_ICON_OPTIONS: { value: FeatureIconName; label: string }[] = [
	{ value: "file-code", label: "代码" },
	{ value: "palette", label: "设计" },
	{ value: "shield-check", label: "安全" },
	{ value: "globe", label: "全球" },
	{ value: "rocket", label: "极速" },
	{ value: "sparkles", label: "精选" },
	{ value: "zap", label: "性能" },
	{ value: "book-open", label: "文档" },
	{ value: "layers", label: "分层" },
	{ value: "wrench", label: "工具" },
	{ value: "cpu", label: "技术" },
	{ value: "boxes", label: "模块" }
];

export const DEFAULT_FEATURE_ICON: FeatureIconName = "sparkles";

export function resolveFeatureIcon(name?: string) {
	if (name && name in FEATURE_ICONS) {
		return FEATURE_ICONS[name as FeatureIconName];
	}
	return FEATURE_ICONS[DEFAULT_FEATURE_ICON];
}
