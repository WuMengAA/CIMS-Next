import {
	Home, Search, Settings, User, Users, Bell, Star, Heart, Bookmark, Tag, Flag, Eye, Lock, Link,
	Globe, Mail, Phone, Calendar, Clock, MapPin,
	File, FileText, FileImage, FileCode, Folder, FolderOpen, Image as ImageIcon, Video, Music, Camera,
	Archive, Download, Upload, Copy, Paperclip,
	Play, Pause, SkipBack, SkipForward, Volume2, Mic, Headphones, Radio, Tv, Monitor, Smartphone,
	Tablet, Laptop, Printer,
	Pencil, Trash2, Plus, Minus, Check, X, Save, Undo2, Redo2, Type, AlignLeft, List, LayoutGrid,
	MessageCircle, Send, Share2, ThumbsUp, Smile, AtSign, Gift, Coffee,
	Wrench, Hammer, Drill, Cog, Cpu, Database, Server, Cloud, Wifi, Key, ShieldCheck, Gauge,
	Lightbulb, Zap, Sparkles,
	BarChart3, PieChart, LineChart, TrendingUp, Activity, Target, Award, Trophy, Medal,
	ArrowRight, ArrowLeft, ArrowUp, ArrowDown, ChevronRight, ChevronDown, ChevronsUpDown,
	CornerDownRight, ExternalLink, Maximize2, Minimize2, Move, RotateCw,
	Palette, Brush, Layers, Layout, Sliders, Droplet, Flower2, Compass
} from "@lucide/svelte";
import type { Component } from "svelte";

export type IconEntry = { name: string; comp: Component };

export const ICON_CATEGORIES: { id: string; label: string; icons: IconEntry[] }[] = [
	{
		id: "general", label: "通用",
		icons: [
			{ name: "home", comp: Home }, { name: "search", comp: Search }, { name: "settings", comp: Settings },
			{ name: "user", comp: User }, { name: "users", comp: Users }, { name: "bell", comp: Bell },
			{ name: "star", comp: Star }, { name: "heart", comp: Heart }, { name: "bookmark", comp: Bookmark },
			{ name: "tag", comp: Tag }, { name: "flag", comp: Flag }, { name: "eye", comp: Eye },
			{ name: "lock", comp: Lock }, { name: "link", comp: Link }, { name: "globe", comp: Globe },
			{ name: "mail", comp: Mail }, { name: "phone", comp: Phone }, { name: "calendar", comp: Calendar },
			{ name: "clock", comp: Clock }, { name: "map-pin", comp: MapPin }
		]
	},
	{
		id: "file", label: "文件",
		icons: [
			{ name: "file", comp: File }, { name: "file-text", comp: FileText }, { name: "file-image", comp: FileImage },
			{ name: "file-code", comp: FileCode }, { name: "folder", comp: Folder }, { name: "folder-open", comp: FolderOpen },
			{ name: "image", comp: ImageIcon }, { name: "video", comp: Video }, { name: "music", comp: Music },
			{ name: "camera", comp: Camera }, { name: "archive", comp: Archive }, { name: "download", comp: Download },
			{ name: "upload", comp: Upload }, { name: "copy", comp: Copy }, { name: "paperclip", comp: Paperclip }
		]
	},
	{
		id: "media", label: "媒体",
		icons: [
			{ name: "play", comp: Play }, { name: "pause", comp: Pause }, { name: "skip-back", comp: SkipBack },
			{ name: "skip-forward", comp: SkipForward }, { name: "volume-2", comp: Volume2 }, { name: "mic", comp: Mic },
			{ name: "headphones", comp: Headphones }, { name: "radio", comp: Radio }, { name: "tv", comp: Tv },
			{ name: "monitor", comp: Monitor }, { name: "smartphone", comp: Smartphone }, { name: "tablet", comp: Tablet },
			{ name: "laptop", comp: Laptop }, { name: "printer", comp: Printer }
		]
	},
	{
		id: "edit", label: "编辑",
		icons: [
			{ name: "pencil", comp: Pencil }, { name: "trash-2", comp: Trash2 }, { name: "plus", comp: Plus },
			{ name: "minus", comp: Minus }, { name: "check", comp: Check }, { name: "x", comp: X },
			{ name: "save", comp: Save }, { name: "undo-2", comp: Undo2 }, { name: "redo-2", comp: Redo2 },
			{ name: "type", comp: Type }, { name: "align-left", comp: AlignLeft }, { name: "list", comp: List },
			{ name: "layout-grid", comp: LayoutGrid }
		]
	},
	{
		id: "social", label: "社交",
		icons: [
			{ name: "message-circle", comp: MessageCircle }, { name: "send", comp: Send }, { name: "share-2", comp: Share2 },
			{ name: "thumbs-up", comp: ThumbsUp }, { name: "smile", comp: Smile }, { name: "at-sign", comp: AtSign },
			{ name: "gift", comp: Gift }, { name: "coffee", comp: Coffee }
		]
	},
	{
		id: "tools", label: "工具",
		icons: [
			{ name: "wrench", comp: Wrench }, { name: "hammer", comp: Hammer }, { name: "drill", comp: Drill },
			{ name: "cog", comp: Cog }, { name: "cpu", comp: Cpu }, { name: "database", comp: Database },
			{ name: "server", comp: Server }, { name: "cloud", comp: Cloud }, { name: "wifi", comp: Wifi },
			{ name: "key", comp: Key }, { name: "shield-check", comp: ShieldCheck }, { name: "gauge", comp: Gauge },
			{ name: "lightbulb", comp: Lightbulb }, { name: "zap", comp: Zap }, { name: "sparkles", comp: Sparkles }
		]
	},
	{
		id: "data", label: "数据",
		icons: [
			{ name: "bar-chart-3", comp: BarChart3 }, { name: "pie-chart", comp: PieChart }, { name: "line-chart", comp: LineChart },
			{ name: "trending-up", comp: TrendingUp }, { name: "activity", comp: Activity }, { name: "target", comp: Target },
			{ name: "award", comp: Award }, { name: "trophy", comp: Trophy }, { name: "medal", comp: Medal }
		]
	},
	{
		id: "arrows", label: "箭头",
		icons: [
			{ name: "arrow-right", comp: ArrowRight }, { name: "arrow-left", comp: ArrowLeft }, { name: "arrow-up", comp: ArrowUp },
			{ name: "arrow-down", comp: ArrowDown }, { name: "chevron-right", comp: ChevronRight }, { name: "chevron-down", comp: ChevronDown },
			{ name: "chevrons-up-down", comp: ChevronsUpDown }, { name: "corner-down-right", comp: CornerDownRight },
			{ name: "external-link", comp: ExternalLink }, { name: "maximize-2", comp: Maximize2 }, { name: "minimize-2", comp: Minimize2 },
			{ name: "move", comp: Move }, { name: "rotate-cw", comp: RotateCw }
		]
	},
	{
		id: "design", label: "设计",
		icons: [
			{ name: "palette", comp: Palette }, { name: "brush", comp: Brush }, { name: "layers", comp: Layers },
			{ name: "layout", comp: Layout }, { name: "sliders", comp: Sliders }, { name: "droplet", comp: Droplet },
			{ name: "flower-2", comp: Flower2 }, { name: "compass", comp: Compass }
		]
	}
];

/** 扁平化：name -> component，供按名称解析渲染。 */
export const ICON_MAP: Record<string, Component> = Object.fromEntries(
	ICON_CATEGORIES.flatMap((c) => c.icons).map((i) => [i.name, i.comp])
);

export function resolveIcon(name?: string): Component | undefined {
	if (name && name in ICON_MAP) return ICON_MAP[name];
	return undefined;
}
