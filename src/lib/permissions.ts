// 统一权限模型：纯函数，前后端通用（无 server-only 依赖）。
//
// ── 设计第一性原理（2026-09-21 重构）─────────────────────────────────────────
//
//  **等级（Level）只是「显示秩位」，不再是权限。称号（Title）才是权限的载体。**
//
//  旧模型（已废弃）把等级当成累积偏序：`can(role, action) = roleToLevel(role) >= LEVEL_OF_ACTION[action]`
//  —— 高等级自动继承低等级的全部能力，于是「等级平移」会静默放大权限（#181 扩级时
//  techrep 2→3 就被动拿到了全校广播与 UGC 审核权）。这正是用户判定「权限分配极不合理」的根因。
//
//  新模型把权限从等级里彻底解耦：
//   - 每个角色拥有一组**称号（Title）**；称号是权限的载体，每个称号显式声明它授予哪些 `Action`。
//   - `can(role, action)` = 「该角色的称号并集是否包含这个 action」——**与等级数值无关**。
//   - `Level`（L1~L6）只用于 UI 展示「秩位高低」（如「L3 电教委员」），不参与任何判定。
//   - 设备轴（watch/control/remote/manage）、广播范围（class/grade/school）、管理分级
//     （class/grade/school）作为**与称号正交的独立轴**，仍按角色表驱动（见 ROLE_DEVICE /
//     ROLE_SCOPE / ROLE_TIER）。其中设备轴按用户原意保持「独立正交轴」不变。
//
//  七类称号（用户拍板，行为保持现状地反推自各角色既有有效权限）：
//     访客 visitor      —— 基础档，仅观看设备
//     参与者 participant —— 评论/发帖/反馈/申请/纠错/班级·年级交流/读取广播
//     电教委员 techcommissioner —— 进入集控面板（本班设备运维主力）
//     广播员 broadcaster —— 发布校/年级广播 + 进面板
//     审核员 reviewer    —— 审核 UGC 与权限申请 + 建频道 + 进后台
//     编辑 editor       —— 内容/页面/媒体管理 + 进后台
//     站长 stationmaster —— 用户/权限/站点设置/全量设备管理
//
//  向后兼容：旧 8 个角色名一个都没删，`ROLE_TITLES` 为它们各配一组称号，使 `can()` 的
//  输出与重构前逐角色逐 action 完全一致（由 `_probe/permissions-invariants.mjs` 守住）。

/** 六级纵向等级。仅作「显示秩位」，不参与任何权限判定。 */
export type Level = 1 | 2 | 3 | 4 | 5 | 6;

/** 角色标识（数据库存的仍是这些值，保持向后兼容）。 */
export type Role =
	| "owner"
	| "admin"
	| "editor"
	| "moderator"
	| "teacher"
	| "homeroom"
	| "user"
	| "techrep"
	| "viewer";

/** 设备操作敏感度轴（横向，独立于称号）。 */
export type DeviceTier = "watch" | "control" | "remote" | "manage";

/** 内容 / 平台动作（纵向能力清单，由称号授予）。 */
export type Action =
	// ---- 集控（可进面板）----
	| "viewConsole" // 进入集控面板（只读观看）
	// ---- 参与 ----
	| "comment" // 发表评论
	| "postForum" // 论坛发帖
	| "submitFeedback" // 提交反馈/issue
	| "submitProject" // 申请软件专页
	| "submitLink" // 申请友链
	| "suggestDoc" // 纠正/建议文档
	| "submitIssue" // 提交故障工单 / Bug
	// ---- 班级/年级沟通 ----
	| "chatClass" // 在本班频道发言
	| "chatGrade" // 在本年级频道发言
	| "readBroadcast" // 读取广播/公告
	// ---- 广播 ----
	| "sendBroadcast" // 发布校/年级广播
	// ---- 审核 / 内容与后台 ----
	| "createChannel" // 建立论坛频道
	| "moderate" // 审核 UGC
	| "reviewPermission" // 审核他人的权限晋升申请
	| "manageContent" // 管理博客/项目/文档
	| "managePages" // 页面编辑与美术设计
	| "manageFiles" // 文件/媒体管理
	| "manageFeeds" // 管理 RSS/内容源
	| "viewAdmin" // 进入后台管理台
	// ---- 治理 ----
	| "manageUsers" // 用户与角色管理
	| "manageSettings" // 站点设置
	| "managePermissions" // 查看/调整权限矩阵
	| "manageDevices"; // 全量设备管理

/** 称号键。权限的真正载体。 */
export type TitleKey =
	| "visitor"
	| "participant"
	| "techcommissioner"
	| "broadcaster"
	| "reviewer"
	| "editor"
	| "stationmaster";

/** 一个称号的静态定义：它授予哪些动作。 */
export interface Title {
	key: TitleKey;
	label: string;
	description: string;
	actions: Action[];
}

/**
 * 称号目录：权限的唯一载体。
 *
 * ⚠️ 每个 action 必须且只由某个（些）称号授予；新增 action 时务必在此挂到合适的称号上，
 * 否则 `can()` 永远为 false，且该 action 也不会出现在权限矩阵（`capabilitiesByLevel` 的覆盖检查会失败）。
 */
export const TITLES: Record<TitleKey, Title> = {
	visitor: {
		key: "visitor",
		label: "访客",
		description: "基础档：仅观看设备状态与画面；一律禁止进入集控面板与后台。",
		actions: []
	},
	participant: {
		key: "participant",
		label: "参与者",
		description: "参与：评论、论坛发帖、反馈、申请专页/友链、文档纠错、班级/年级交流、读取广播。",
		actions: [
			"comment",
			"postForum",
			"submitFeedback",
			"submitProject",
			"submitLink",
			"suggestDoc",
			"submitIssue",
			"chatClass",
			"chatGrade",
			"readBroadcast"
		]
	},
	techcommissioner: {
		key: "techcommissioner",
		label: "电教委员",
		description: "进入集控面板，运维本班设备（本班设备操作主力）。",
		actions: ["viewConsole"]
	},
	broadcaster: {
		key: "broadcaster",
		label: "广播员",
		description: "发布校/年级广播（含推送到教室大屏），并进入集控面板。",
		actions: ["sendBroadcast", "viewConsole"]
	},
	reviewer: {
		key: "reviewer",
		label: "审核员",
		description: "审核 UGC 与权限申请、建立频道，并进入后台与集控面板。",
		actions: ["moderate", "createChannel", "reviewPermission", "viewConsole"]
	},
	editor: {
		key: "editor",
		label: "编辑",
		description: "管理与编辑内容/页面/媒体，并进入后台。",
		actions: ["manageContent", "managePages", "manageFiles", "manageFeeds", "viewAdmin", "viewConsole"]
	},
	stationmaster: {
		key: "stationmaster",
		label: "站长",
		description: "用户、权限、站点设置与全量设备管理（最高权限集合）。",
		actions: ["manageUsers", "manageSettings", "managePermissions", "manageDevices", "viewConsole"]
	}
};

/** 全部称号键（遍历用）。 */
export const TITLE_KEYS: TitleKey[] = Object.keys(TITLES) as TitleKey[];

/**
 * 角色 → 称号预设。
 *
 * 这是「旧等级模型」到「新称号模型」的桥：为每个角色挑一组称号，使其 `can()` 的
 * 输出与重构前逐角色逐 action 完全一致（行为保持）。要调整某角色的权限，改这里的
 * 称号组合即可——**不要再碰等级数值**。
 *
 * 反推依据（角色既有有效动作）：
 *   viewer  → 无内容动作
 *   user    → 参与者全部（L2）
 *   techrep → 参与者 + 进面板（viewConsole）
 *   teacher → 参与者 + 广播员（sendBroadcast + 进面板）
 *   moderator/editor（同为 L5）→ 参与者 + 广播员 + 审核员 + 编辑（全部 L5 动作）
 *   admin/owner（L6）→ 再加站长（manage* 系列）
 */
export const ROLE_TITLES: Record<Role, TitleKey[]> = {
	viewer: ["visitor"],
	user: ["visitor", "participant"],
	techrep: ["visitor", "participant", "techcommissioner"],
	// 班主任：能进面板（viewConsole）+ 参与者 + 广播员（本班/年级广播）。
	// 设备轴走独立正交轴（ROLE_DEVICE.homeroom = watch/control/remote），与内容称号无关。
	homeroom: ["visitor", "participant", "broadcaster"],
	teacher: ["visitor", "participant", "broadcaster"],
	editor: ["visitor", "participant", "broadcaster", "reviewer", "editor"],
	moderator: ["visitor", "participant", "broadcaster", "reviewer", "editor"],
	admin: ["visitor", "participant", "broadcaster", "reviewer", "editor", "stationmaster"],
	owner: ["visitor", "participant", "broadcaster", "reviewer", "editor", "stationmaster"]
};

/** 角色 → 称号键列表（空/未知角色回退到 visitor 基础档）。 */
export function titlesOf(role: Role | null | undefined): TitleKey[] {
	if (!role) return ["visitor"];
	return ROLE_TITLES[role] ?? ["visitor"];
}

/** 把一组称号展开成「动作集合」（去重）。 */
export function actionsOfTitles(titles: TitleKey[]): Set<Action> {
	const s = new Set<Action>();
	for (const t of titles) {
		const def = TITLES[t];
		if (def) for (const a of def.actions) s.add(a);
	}
	return s;
}

/**
 * 纵向「等级轴」标签（仅展示用）。
 * ⚠️ 仅用于 UI 显示「秩位」，不参与 `can()` 判定——权限来自称号。
 */
export const LEVEL_LABELS: Record<Level, string> = {
	1: "L1 游客",
	2: "L2 学生",
	3: "L3 电教委员",
	4: "L4 老师",
	5: "L5 审核·编辑",
	6: "L6 管理·站长"
};

export const LEVEL_DESCRIPTIONS: Record<Level, string> = {
	1: "只读：浏览公开内容。",
	2: "参与：评论、发帖、反馈、申请友链与专页、文档纠错。",
	3: "电教委员：进入集控面板，运维本班设备（锁屏/截图/远控本班）。",
	4: "老师：带班管理、发本年级广播。",
	5: "审核·编辑：审核 UGC 与权限申请，管理内容/页面/媒体，可进入后台。",
	6: "管理·站长：管理用户、权限与站点设置，含全量设备。"
};

export const DEVICE_LABELS: Record<DeviceTier, string> = {
	watch: "观看",
	control: "控制",
	remote: "远程",
	manage: "管理"
};

export const DEVICE_DESCRIPTIONS: Record<DeviceTier, string> = {
	watch: "查看设备状态与画面（只读）",
	control: "本班/本年级设备的锁屏、重启、截图",
	remote: "远程屏幕控制（更高敏感，需显式授权）",
	manage: "全量设备增删改与策略下发"
};

/** 角色 -> 等级（仅展示）。 */
export function roleToLevel(role: Role | null | undefined): Level | null {
	if (!role) return null;
	return ROLE_LEVEL[role] ?? null;
}

/** 角色 -> 设备档位（默认档，与称号正交）。 */
export function roleDeviceTiers(role: Role | null | undefined): DeviceTier[] {
	if (!role) return [];
	return ROLE_DEVICE[role] ?? [];
}

/** 角色的中文标签。owner/admin 都显示「站长」。 */
export const ROLE_LABELS: Record<Role, string> = {
	owner: "站长",
	admin: "站长",
	editor: "编辑",
	moderator: "审核员",
	teacher: "老师",
	homeroom: "班主任",
	user: "学生",
	techrep: "电教委员",
	viewer: "游客"
};

/** 角色的等级标签（UI 上「L4 编辑」这类展示）。 */
export function roleLevelLabel(role: Role | null | undefined): string {
	const lv = roleToLevel(role);
	return lv === null ? "未登录" : LEVEL_LABELS[lv];
}

/**
 * 权限判定核心：**由称号驱动，与等级数值无关**。
 * 未登录一律 false。传入的 role 通过 ROLE_TITLES 解析为称号并集再做判断。
 */
export function can(role: Role | null | undefined, action: Action): boolean {
	if (!role) return false;
	const acts = actionsOfTitles(titlesOf(role));
	return acts.has(action);
}

/**
 * 以「用户对象」判定权限——支持每人独立追加/撤回称号。
 *
 * 解析规则：
 *  - 用户对象携带 `titles`（来自 `user_titles` 表，由 auth 层附加）且为非空数组时，
 *    以该显式集合为有效称号（完整覆盖，可增可减，实现「独立追加/撤回」）；
 *  - 否则回退到角色预设 `titlesOf(role)`（行为与 `can(role, action)` 一致）。
 *
 * 这样每个用户的权限 = 其被显式授予的称号并集，与等级脱钩。
 */
export function userCan(
	user: { role?: Role | null; titles?: TitleKey[] | null } | null | undefined,
	action: Action
): boolean {
	if (!user) return false;
	const titles = user.titles && user.titles.length ? user.titles : titlesOf(user.role ?? null);
	return actionsOfTitles(titles).has(action);
}

// ── 设备轴（横向，独立于称号）────────────────────────────────────────────────
//
// 设备操作敏感度，与称号正交：电教委员（techrep）内容等级只有 L2，却持 remote 设备权限；
// 站长等级最高，设备操作仍单独判定（避免「职位高就一定能远控学生机」的危险默认）。
// 两层分别用 can() / canDevice()。

const ROLE_DEVICE: Record<Role, DeviceTier[]> = {
	owner: ["watch", "control", "remote", "manage"],
	admin: ["watch", "control", "remote", "manage"],
	// ⚠️ 设备三关铁律（#249，2026-09-21 方案）：能碰设备（**含看画面 watch**）的
	// 只有 站长(owner/admin) / 班主任(homeroom) / 电教委员(techrep)。其余角色一律
	// 清空设备档位 —— 不是前端藏，是权限层就没有（本机截图=敏感内容）。
	editor: [],
	moderator: [],
	// 老师（任课教师）2026-09-21 方案：收回全部设备档，连画面都没有。
	// 之前提档到 remote 与铁律冲突，已回退（带班的设备运维归班主任 homeroom）。
	teacher: [],
	user: [],
	techrep: ["watch", "control", "remote"],
	// 班主任：本班设备全部（含远控），与电教委员同档；本班归属由代理层按绑定班级收敛。
	homeroom: ["watch", "control", "remote"],
	viewer: []
};

/** 设备档位高低序（判定「包含」用）。 */
const DEVICE_RANK: Record<DeviceTier, number> = { watch: 0, control: 1, remote: 2, manage: 3 };

/** 设备轴权限判定（包含语义：持 remote 自动拥有 control 与 watch）。 */
export function canDevice(role: Role | null | undefined, tier: DeviceTier): boolean {
	const tiers = roleDeviceTiers(role);
	if (tiers.length === 0) return false;
	const need = DEVICE_RANK[tier];
	return tiers.some((t) => DEVICE_RANK[t] >= need);
}

/** 当前角色对集控面板是否处于「纯观看」状态（无任何写操作）。 */
export function isConsoleReadOnly(role: Role | null | undefined): boolean {
	return canDevice(role, "watch") && !canDevice(role, "control");
}

// ── 广播可达范围（与称号正交的独立轴）────────────────────────────────────────

export type BroadcastScope = "class" | "grade" | "school";

const SCOPE_RANK: Record<BroadcastScope, number> = { class: 0, grade: 1, school: 2 };

export const BROADCAST_SCOPE_LABELS: Record<BroadcastScope, string> = {
	class: "本班",
	grade: "本年级",
	school: "全校"
};

/** 角色 → 广播可达范围（null = 完全不能广播）。按角色表驱动（与称号正交）。 */
const ROLE_SCOPE: Record<Role, BroadcastScope | null> = {
	owner: "school",
	admin: "school",
	editor: "school",
	moderator: "grade",
	teacher: "grade",
	// 班主任：本班/年级广播（方案表：本班/年级）
	homeroom: "grade",
	techrep: "class",
	user: "class",
	viewer: null
};

/** 角色能广播的最大范围；返回 null 表示完全不能广播（L1 游客）。 */
export function broadcastScope(role: Role | null | undefined): BroadcastScope | null {
	if (!role) return null;
	return ROLE_SCOPE[role] ?? null;
}

/** 该角色能否广播到指定范围（范围档位不超过其上限）。 */
export function canBroadcastTo(role: Role | null | undefined, scope: BroadcastScope): boolean {
	const max = broadcastScope(role);
	if (!max) return false;
	return SCOPE_RANK[max] >= SCOPE_RANK[scope];
}

/** 把界面上的范围文案归一成档位（认不出按最严的 class 处理）。 */
export function scopeFromLabel(label: unknown): BroadcastScope {
	const s = String(label ?? "").trim();
	if (s.includes("全校") || s.includes("广播")) return "school";
	if (s.includes("年级")) return "grade";
	return "class";
}

/** 角色可选的广播范围清单（面板下拉用）。 */
export function allowedBroadcastScopes(role: Role | null | undefined): BroadcastScope[] {
	const max = broadcastScope(role);
	if (!max) return [];
	return (["class", "grade", "school"] as BroadcastScope[]).filter((s) => SCOPE_RANK[s] <= SCOPE_RANK[max]);
}

/** 把「想要的范围」收敛到角色上限之内（放行则原样返回，超出则收窄到上限，无权限返回 null）。 */
export function clampBroadcastScope(
	role: Role | null | undefined,
	want: BroadcastScope
): BroadcastScope | null {
	const max = broadcastScope(role);
	if (!max) return null;
	return SCOPE_RANK[max] >= SCOPE_RANK[want] ? want : max;
}

// ── 权限晋升申请的「能力证明」目录 ──────────────────────────────────────────
export const PROOF_TYPES: { key: string; label: string; hint: string }[] = [
	{ key: "teacher_id", label: "教师工号 / 教工证", hint: "填写工号或证件编号，审核时会与学校名单核对" },
	{ key: "class_device", label: "班级设备编号", hint: "教室一体机 / ClassIsland 设备码（如 lab-pc-001）" },
	{ key: "school_email", label: "学校邮箱", hint: "以学校域名结尾的邮箱地址（如 @xxx.edu.cn）" },
	{ key: "work_order", label: "集控工单记录", hint: "你在集控里处理过的故障工单编号或时间" },
	{ key: "vouch", label: "现任管理员推荐", hint: "推荐人的用户名，审核时会向本人确认" }
];

export const PROOF_TYPE_KEYS: string[] = PROOF_TYPES.map((p) => p.key);
export const PROOF_TYPE_LABELS: Record<string, string> = Object.fromEntries(
	PROOF_TYPES.map((p) => [p.key, p.label])
);

// ── 管理分级（组织层：谁管谁；与称号正交）────────────────────────────────────
export type ManagementTier = "class" | "grade" | "school";

const TIER_RANK: Record<ManagementTier, number> = { class: 0, grade: 1, school: 2 };

export const MANAGEMENT_TIER_LABELS: Record<ManagementTier, string> = {
	class: "班级 · 电教委员",
	grade: "年级 · 年级管理员",
	school: "校级 · 校级管理员"
};

export const MANAGEMENT_TIER_DESCRIPTIONS: Record<ManagementTier, string> = {
	class: "管本班：锁屏/截图/远控本班设备，发本班广播，本班交流。不可跨班。",
	grade: "管本年级：审核本年级内容、发本年级广播、查看本年级设备与电教委员。",
	school: "管全校：用户与角色、全量设备与策略、全校广播、站点设置。"
};

const ROLE_TIER: Record<Role, ManagementTier> = {
	owner: "school",
	admin: "school",
	editor: "school",
	moderator: "grade",
	teacher: "grade",
	// 班主任：管理分级与本班绑定（设备代理层按绑定班级收敛）；广播范围另有 grade。
	homeroom: "class",
	techrep: "class",
	user: "class",
	viewer: "class"
};

/** 角色 → 管理分级。 */
export function roleManagementTier(role: Role | null | undefined): ManagementTier | null {
	if (!role) return null;
	return ROLE_TIER[role] ?? null;
}

/** 该角色能管到的最大范围（与广播范围共用 class/grade/school 三档语义）。 */
export function managementScope(role: Role | null | undefined): BroadcastScope | null {
	const t = roleManagementTier(role);
	return t ?? null;
}

/** 是否属于「班级层」——面板据此把跨班入口整体收起。 */
export function isClassScoped(role: Role | null | undefined): boolean {
	return roleManagementTier(role) === "class";
}

/** 校验「操作者能否管理某个目标班级」（校级/年级/班级三档，含同年级前缀匹配）。 */
export function canManageClass(
	role: Role | null | undefined,
	actor: { classId?: string | null; gradeName?: string | null },
	target: { classId?: string | null; gradeName?: string | null }
): boolean {
	const scope = managementScope(role);
	if (!scope) return false;
	if (scope === "school") return true;
	if (scope === "grade") {
		const a = (actor.gradeName ?? "").trim();
		const b = (target.gradeName ?? "").trim();
		if (!a || !b) return false;
		return a === b || a.startsWith(b) || b.startsWith(a);
	}
	const a = (actor.classId ?? "").trim();
	const b = (target.classId ?? "").trim();
	return !!a && !!b && a === b;
}

/** 把「目标范围」收敛到角色可管范围内（null = 完全不可管）。 */
export function clampManagementScope(
	role: Role | null | undefined,
	want: BroadcastScope
): BroadcastScope | null {
	const max = managementScope(role);
	if (!max) return null;
	return TIER_RANK[max] >= TIER_RANK[want] ? want : max;
}

export const ASSIGNABLE_TIERS: ManagementTier[] = ["class", "grade", "school"];

// ── 等级 ↔ 角色映射（仅展示用，驱动标签与矩阵样例角色）──────────────────────

const ROLE_LEVEL: Record<Role, Level> = {
	owner: 6,
	admin: 6,
	editor: 5,
	moderator: 5,
	teacher: 4,
	homeroom: 4,
	techrep: 3,
	user: 2,
	viewer: 1
};

/**
 * ⚠️ 仅用于「权限矩阵页」展示「某个动作由哪一等级引入」。
 * 重构后它**不再参与 `can()` 判定**——权限来自称号。请勿在此新增任何判定逻辑。
 */
const LEVEL_OF_ACTION: Record<Action, Level> = {
	viewConsole: 3,
	comment: 2,
	postForum: 2,
	submitFeedback: 2,
	submitProject: 2,
	submitLink: 2,
	suggestDoc: 2,
	submitIssue: 2,
	readBroadcast: 2,
	chatClass: 2,
	chatGrade: 2,
	sendBroadcast: 4,
	moderate: 5,
	createChannel: 5,
	reviewPermission: 5,
	manageContent: 5,
	managePages: 5,
	manageFiles: 5,
	manageFeeds: 5,
	viewAdmin: 5,
	manageUsers: 6,
	manageSettings: 6,
	managePermissions: 6,
	manageDevices: 6
};

/** 角色能力摘要（用于界面直观展示）。actions 现由称号并集推导。 */
export function roleCapabilitiesSummary(role: Role | null | undefined): {
	level: Level | null;
	levelLabel: string;
	actions: Action[];
	deviceTiers: DeviceTier[];
	isUserPlusDevice: boolean;
} {
	const lv = roleToLevel(role);
	const actions = Array.from(actionsOfTitles(titlesOf(role)));
	return {
		level: lv,
		levelLabel: lv === null ? "未登录" : LEVEL_LABELS[lv],
		actions,
		deviceTiers: roleDeviceTiers(role),
		// 电教委员 = 参与者能力 + 设备权限（叠加，而非替代）
		isUserPlusDevice: role === "techrep"
	};
}

/**
 * 面板「权限与分级」页的完整快照（服务端算好后一次性下发）。
 * 前端拿到的必须是"服务端认为你能做什么"，而不是"前端自己推导出你能做什么"。
 *
 * @param user 可传用户对象（含显式称号 `titles`，来自 user_titles 表）或纯角色。
 *   传用户对象时 me 快照会反映**实际生效**的称号（覆盖写优先），与 userCan() 门控同源；
 *   传纯角色时退化为角色预设（等价于重构前行为）。
 */
export function permissionMatrix(
	user: { role?: Role | null; titles?: TitleKey[] | null } | Role | null | undefined
) {
	const role = (typeof user === "object" && user !== null ? user.role : user) ?? null;
	const titles =
		typeof user === "object" && user !== null && user.titles && user.titles.length
			? user.titles
			: titlesOf(role);
	const acts = actionsOfTitles(titles);
	const actions = Array.from(acts);
	const scope = broadcastScope(role);
	const tier = roleManagementTier(role);
	return {
		// 当前账号快照
		me: {
			role,
			roleLabel: role ? ROLE_LABELS[role] : "未登录",
			level: roleToLevel(role),
			levelLabel: role ? roleLevelLabel(role) : "未登录",
			// 称号（权限的真实载体）—— 显式覆盖优先，与 userCan() 同源
			titles,
			titleLabels: titles.map((t) => TITLES[t].label),
			actions,
			actionLabels: actions.map((a) => ACTION_LABELS[a]),
			deviceTiers: roleDeviceTiers(role),
			isUserPlusDevice: role === "techrep",
			managementTier: tier,
			managementTierLabel: tier ? MANAGEMENT_TIER_LABELS[tier] : "—",
			managementTierDescription: tier ? MANAGEMENT_TIER_DESCRIPTIONS[tier] : "",
			broadcastScopes: allowedBroadcastScopes(role),
			broadcastScopeLabel: scope ? BROADCAST_SCOPE_LABELS[scope] : "不可广播",
			canManageClassScope: scope === "class",
			canManageGrade: tier === "grade",
			canManageSchool: tier === "school"
		},
		// 等级轴（仅展示秩位，不参与判定）
		levels: capabilitiesByLevel().map((g) => ({
			level: g.level,
			label: LEVEL_LABELS[g.level],
			description: LEVEL_DESCRIPTIONS[g.level],
			sampleRole: LEVEL_SAMPLE_ROLE[g.level],
			actions: g.actions.map((a) => ({ key: a, label: ACTION_LABELS[a] }))
		})),
		// 称号目录（权限的真实载体，供面板展示「我的称号」）
		titles: TITLE_KEYS.map((k) => ({
			key: k,
			label: TITLES[k].label,
			description: TITLES[k].description,
			actions: TITLES[k].actions.map((a) => ({ key: a, label: ACTION_LABELS[a] }))
		})),
		// 设备轴
		deviceTiers: (Object.keys(DEVICE_LABELS) as DeviceTier[]).map((t) => ({
			key: t,
			label: DEVICE_LABELS[t],
			description: DEVICE_DESCRIPTIONS[t],
			roles: (Object.keys(ROLE_LABELS) as Role[]).filter((r) => canDevice(r, t)).map((r) => ROLE_LABELS[r])
		})),
		// 分级轴
		managementTiers: ASSIGNABLE_TIERS.map((t) => ({
			key: t,
			label: MANAGEMENT_TIER_LABELS[t],
			description: MANAGEMENT_TIER_DESCRIPTIONS[t],
			roles: (Object.keys(ROLE_LABELS) as Role[])
				.filter((r) => roleManagementTier(r) === t)
				.map((r) => ROLE_LABELS[r])
		})),
		// 广播范围轴
		broadcastScopes: (["class", "grade", "school"] as BroadcastScope[]).map((s) => ({
			key: s,
			label: BROADCAST_SCOPE_LABELS[s],
			roles: (Object.keys(ROLE_LABELS) as Role[])
				.filter((r) => canBroadcastTo(r, s))
				.map((r) => ROLE_LABELS[r])
		})),
		// 全部角色（面板做"角色 → 能力"对照表）
		roles: ASSIGNABLE_ROLES.map((r) => {
			const s = broadcastScope(r);
			const t = roleManagementTier(r);
			return {
				key: r,
				label: ROLE_LABELS[r],
				level: roleToLevel(r),
				levelLabel: roleLevelLabel(r),
				titles: titlesOf(r),
				titleLabels: titlesOf(r).map((tt) => TITLES[tt].label),
				deviceTiers: roleDeviceTiers(r),
				managementTier: t,
				managementTierLabel: t ? MANAGEMENT_TIER_LABELS[t] : "—",
				broadcastScope: s,
				broadcastScopeLabel: s ? BROADCAST_SCOPE_LABELS[s] : "不可广播"
			};
		})
	};
}

/** 可分配角色清单，按等级从高到低（用户管理下拉复用）。 */
export const ASSIGNABLE_ROLES: Role[] = [
	"admin",
	"owner",
	"editor",
	"moderator",
	"teacher",
	"homeroom",
	"techrep",
	"user",
	"viewer"
];

/** 动作的中文说明（权限矩阵表头用）。 */
export const ACTION_LABELS: Record<Action, string> = {
	comment: "发表评论",
	postForum: "论坛发帖",
	submitFeedback: "提交反馈",
	submitProject: "申请专页",
	submitLink: "申请友链",
	suggestDoc: "文档纠错",
	submitIssue: "提交工单",
	chatClass: "本班频道发言",
	chatGrade: "年级群发言",
	readBroadcast: "读取广播",
	createChannel: "创建频道",
	moderate: "审核 UGC",
	reviewPermission: "审核权限申请",
	sendBroadcast: "发布广播",
	manageContent: "管理内容",
	managePages: "页面/美术编辑",
	manageFiles: "媒体管理",
	manageFeeds: "内容源管理",
	viewAdmin: "进入后台",
	viewConsole: "进入集控面板",
	manageUsers: "用户管理",
	manageSettings: "站点设置",
	managePermissions: "权限管理",
	manageDevices: "全量设备管理"
};

/** 按等级归组的能力清单（权限矩阵页按行渲染；仅展示，LEVEL_OF_ACTION 不再参与判定）。 */
export function capabilitiesByLevel(): { level: Level; actions: Action[] }[] {
	const levels: Level[] = [1, 2, 3, 4, 5, 6];
	return levels.map((level) => ({
		level,
		actions: (Object.keys(LEVEL_OF_ACTION) as Action[]).filter((a) => LEVEL_OF_ACTION[a] === level)
	}));
}

/** 某角色在矩阵中的能力快照（矩阵页逐格打勾）。 */
export function hasAction(role: Role, action: Action): boolean {
	return can(role, action);
}

/** 代表各等级的「示例角色」，用于矩阵列头展示。 */
export const LEVEL_SAMPLE_ROLE: Record<Level, Role> = {
	1: "viewer",
	2: "user",
	3: "techrep",
	4: "teacher",
	5: "moderator",
	6: "admin"
};

/**
 * 按称号归组的能力清单（权限矩阵「称号视角」）。
 * 每个称号一行，列出它授予的动作——直观展示「权限来自称号，而非等级」。
 */
export function capabilitiesByTitle(): { key: TitleKey; label: string; description: string; actions: Action[] }[] {
	return TITLE_KEYS.map((k) => ({
		key: k,
		label: TITLES[k].label,
		description: TITLES[k].description,
		actions: TITLES[k].actions
	}));
}
