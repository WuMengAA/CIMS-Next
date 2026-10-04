/**
 * 网站端 IA（信息架构）单一真源。
 *
 * 与 Flutter 端 `admin-console-native/lib/core/ia.dart` 同构：
 * 「后台四大模块」「前台 ≤3 分类」「前台底部固定栏」的命名与归属只在这里定义，
 * 侧栏 / 导航 / 底部栏一律从这里读 —— 调整结构只改这一处，不再各处硬编码 group。
 *
 * 后台四大模块：概览 ｜ 内容与运营 ｜ 用户与权限 ｜ 设置
 *  （旧后台的 6 组「概览/内容/审核/运营/设备/治理」在此归并：
 *    内容 + 运营 + 设备(教室) → 内容与运营
 *    审核 + 治理(用户/权限/归档) → 用户与权限
 *    治理(登录授权/站点设置/镜像站) → 设置）
 */

export const IA_BACKEND_MODULES = ["概览", "内容与运营", "用户与权限", "设置"] as const;
export type IaBackendModule = (typeof IA_BACKEND_MODULES)[number];

/** 前台（面向使用者）二级菜单 —— 分类数 ≤ 3，禁止再增。 */
export const IA_FRONT_SECTIONS = ["概览", "功能", "设置"] as const;

/** 前台底部固定栏：一行三图标（反馈/公告/提示），外加账户与前后台切换。 */
export const IA_FRONT_BAR_ICONS = ["反馈", "公告", "提示"] as const;

export type IaPlacement = { module: IaBackendModule; sub?: string };

/**
 * 后台每个视图 → 归属模块（+ 模块内小标题）。
 * 键是路由 url，与 `src/routes/admin/+layout.svelte` 的 NAV 项一一对应。
 * 新增后台页时**必须**在此登记，否则侧栏会落到兜底模块里。
 */
export const IA_BACKEND_MAP: Record<string, IaPlacement> = {
	// ── 概览 ─────────────────────────────────────────────
	"/admin": { module: "概览" },
	"/admin/health": { module: "概览" },
	"/admin/console": { module: "概览" },

	// ── 内容与运营 ───────────────────────────────────────
	"/admin/posts": { module: "内容与运营", sub: "内容" },
	"/admin/projects": { module: "内容与运营", sub: "内容" },
	"/admin/project-board": { module: "内容与运营", sub: "内容" },
	"/admin/docs": { module: "内容与运营", sub: "内容" },
	"/admin/pages": { module: "内容与运营", sub: "内容" },
	"/admin/media": { module: "内容与运营", sub: "内容" },
	"/admin/changelog": { module: "内容与运营", sub: "内容" },
	"/admin/library": { module: "内容与运营", sub: "内容" },
	"/admin/announcements": { module: "内容与运营", sub: "运营" },
	"/admin/feed": { module: "内容与运营", sub: "运营" },
	"/admin/links": { module: "内容与运营", sub: "运营" },
	"/admin/nav": { module: "内容与运营", sub: "运营" },
	"/admin/activities": { module: "内容与运营", sub: "运营" },
	"/admin/console/manage": { module: "内容与运营", sub: "教室" },
	"/admin/console/messages": { module: "内容与运营", sub: "教室" },
	"/admin/console/monitor": { module: "内容与运营", sub: "教室" },
	"/admin/console/classes": { module: "内容与运营", sub: "教室" },
	"/admin/console/remote": { module: "内容与运营", sub: "教室" },
	// 2026-10-02 D6：手机集控（复用站点账号 + 云端 /ws/viewer 的 WS+JPEG 截图路径）。
	"/admin/console/mobile": { module: "内容与运营", sub: "教室" },
	// 2026-10-02 A4.3 第二批迁移的三页：同属「内容与运营 / 教室」，与兄弟页一致。
	"/admin/console/random": { module: "内容与运营", sub: "教室" },
	"/admin/console/volume": { module: "内容与运营", sub: "教室" },
	"/admin/console/classisland": { module: "内容与运营", sub: "教室" },
	// 同日补登记：定时任务 / 点歌台（页已存在，之前漏登记会让它们成为"没入口"的孤儿页）。
	"/admin/console/schedule": { module: "内容与运营", sub: "教室" },
	"/admin/console/scheduled": { module: "内容与运营", sub: "教室" },
	"/admin/console/swap": { module: "内容与运营", sub: "教室" },
	"/admin/console/voicehub": { module: "内容与运营", sub: "教室" },
	"/admin/class8": { module: "内容与运营", sub: "教室" },

	// ── 用户与权限 ───────────────────────────────────────
	"/admin/users": { module: "用户与权限", sub: "用户" },
	"/admin/permissions": { module: "用户与权限", sub: "用户" },
	"/admin/archives": { module: "用户与权限", sub: "用户" },
	"/admin/comments": { module: "用户与权限", sub: "审核" },
	"/admin/feedback": { module: "用户与权限", sub: "审核" },
	"/admin/forum": { module: "用户与权限", sub: "审核" },
	"/admin/link-applications": { module: "用户与权限", sub: "审核" },
	"/admin/project-applications": { module: "用户与权限", sub: "审核" },
	"/admin/doc-corrections": { module: "用户与权限", sub: "审核" },
	"/admin/role-requests": { module: "用户与权限", sub: "审核" },

	// ── 设置 ─────────────────────────────────────────────
	"/admin/oauth": { module: "设置" },
	"/admin/settings": { module: "设置" },
	"/admin/mirror": { module: "设置" }
};

/** 兜底模块：NAV 里有、IA_BACKEND_MAP 里漏登记时用（正常不应发生）。 */
export const IA_BACKEND_FALLBACK: IaBackendModule = "内容与运营";

/** 取某个后台 url 的模块归属（未登记则兜底）。 */
export function iaPlacementOf(url: string): IaPlacement {
	return IA_BACKEND_MAP[url] ?? { module: IA_BACKEND_FALLBACK };
}
