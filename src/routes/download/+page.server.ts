/**
 * /download —— 官网下载中心：统一资源整合面板。
 *
 * 数据源：`/api/download`（服务端聚合项目发行包 + 上传资源），页面只负责
 * 搜索框 + 分类标签 + 结果列表 + 复制 sha256。
 *
 * 保留原先的「被控端 / 管理端」装机入口卡片（CATALOG 纯展示文案写死在这里，
 * 版本号仍实时取云端 ota —— 见 $lib/server/downloads.ts）。
 */

import { fetchPublished, humanSize } from "$lib/server/downloads.js";
import type { PageServerLoad } from "./$types";

/** 两个产品的"人话介绍"（纯展示文案，写死）。 */
const CATALOG = [
	{
		id: "agent" as const,
		name: "被控端 · 教室机",
		who: "每一台教室机",
		icon: "server",
		summary:
			"装完开机自启、常驻托盘：接收管理端指令（锁屏 / 全屏通知 / 音量 / 开关机）、定时任务、抓屏与文件收发，并支持 OTA 自更新。",
		steps: [
			"以管理员身份运行安装包，在「装机参数」里填 云端地址 / 设备令牌 / 设备代号（uid）。",
			"或让管理员在集控控制台生成这台机器的「一机一密」装机 bat，到教室机双击即可 —— 不用敲命令、不用手改配置。",
			"装好后托盘出现图标，设备列表里能看到这台机器在线。"
		]
	},
	{
		id: "viewer" as const,
		name: "管理端 · 老师机",
		who: "老师机 / 管理机（通常一台）",
		icon: "monitor",
		summary:
			"老师看到的那个界面：设备列表、远程画面、发通知、推文件、定时任务、软件与媒体管控。",
		steps: [
			"绿色版免安装：解压后双击 viewer-qt.exe 即可运行，无注册表项、拷走即用。",
			"首次运行把管理员给的「云端地址 + 管理端令牌」写进同目录 viewer.env，或按部署说明设环境变量。",
			"升级方式：整个目录替换即可（配置文件在目录里，可先备份）。"
		]
	}
];

/** 资源分类（与 /api/download 的 types 对齐）。 */
const TYPES: { key: string; label: string }[] = [
	{ key: "project", label: "项目发行" },
	{ key: "image", label: "图片" },
	{ key: "video", label: "视频" },
	{ key: "doc", label: "文档" },
	{ key: "app", label: "应用" }
];

/** 从公开下载端点拉全量（服务端聚合，避免浏览器直连云端）。 */
async function fetchAll(): Promise<{ id: string; type: string; title: string; desc: string; url: string; size: number; date: string; sizeText: string }[]> {
	const base = process.env.SITE_ORIGIN || "http://127.0.0.1:8090";
	try {
		const res = await fetch(`${base}/api/download`, { signal: AbortSignal.timeout(5000) });
		if (!res.ok) return [];
		const j = (await res.json()) as { ok?: boolean; items?: unknown[] };
		return Array.isArray(j.items) ? (j.items as never[]) : [];
	} catch {
		return [];
	}
}

export const load: PageServerLoad = async ({ url }) => {
	const q = (url.searchParams.get("q") || "").slice(0, 60);
	const rawType = url.searchParams.get("type") || "";
	const type = TYPES.some((t) => t.key === rawType) ? rawType : "";

	const [products, allItems] = await Promise.all([
		Promise.all(CATALOG.map(async (c) => {
			const state = await fetchPublished(c.id);
			return {
				id: c.id,
				name: c.name,
				who: c.who,
				summary: c.summary,
				steps: c.steps,
				published: state.published,
				version: state.published ? state.latest.version : "",
				url: state.published ? state.latest.url : "",
				sha256: state.published ? state.latest.sha256 : "",
				notes: state.published ? state.latest.notes : "",
				sizeText: state.published ? humanSize(state.latest.size) : "-",
				error: state.published ? "" : state.error || ""
			};
		})),
		fetchAll()
	]);

	// 客户端继续过滤（q / type 变化不重新拉全量；数据量小，一次拉齐更顺滑）
	return {
		products,
		allItems,
		types: TYPES,
		initialQ: q,
		initialType: type
	};
};
