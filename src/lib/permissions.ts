// 统一权限模型：纯函数，前后端通用（无 server-only 依赖）。
//
// ── 两条互相独立的权限轴 ────────────────────────────────────────────────────
//
//  1) 纵向「等级轴」LEVEL —— 内容与平台治理能力，五等，从低到高：
//       L1 访客/只读  viewer    只读浏览公开内容（如获授权可只读看集控）
//       L2 注册用户    user      参与：评论、发帖、反馈、申请、纠错
//       L3 审核员      moderator 在 L2 之上审核 UGC
//       L4 编辑        editor    在 L3 之上管理内容/页面/媒体，可进后台
//       L5 站长        admin    在 L4 之上管理用户、权限、站点设置
//
//  2) 横向「设备轴」DEVICE —— 集控设备操作敏感度，与等级正交：
//       watch  观看  看状态/画面（只读）
//       control 控制 本班/本年级锁屏、重启、截图
//       remote  远程 远程屏幕控制（更高敏感）
//       manage  管理 全量设备增删改与策略下发
//
// 关键设计：设备轴不「包含」于等级轴。电教委员（techrep）内容等级只有 L2，
// 却持 remote 设备权限；站长等级最高，设备操作仍单独判定（避免「职位高就
// 一定能远控学生机」的危险默认）。两层分别用 can() / canDevice()。
//
// 兼容：旧 6 角色名一个都没删。techrep / viewer 通过 roleToLevel() /
// roleDeviceTiers() 映射到新模型，故既有调用点无需改动。旧矩阵里
// editor 的 controlDevice 等档位也原样保留在设备轴默认档中。

/** 五级纵向等级。数值越大权限越高。 */
export type Level = 1 | 2 | 3 | 4 | 5;

/** 角色标识（数据库存的仍是这些值，保持向后兼容）。 */
export type Role = "owner" | "admin" | "editor" | "moderator" | "user" | "techrep" | "viewer";

/** 设备操作敏感度轴（横向，独立于等级）。 */
export type DeviceTier = "watch" | "control" | "remote" | "manage";

/** 内容 / 平台动作（纵向能力清单）。 */
export type Action =
	// ---- L1：只读 ----
	| "viewConsole" // 进入集控面板（只读观看）
	// ---- L2 起：参与 ----
	| "comment" // 发表评论
	| "postForum" // 论坛发帖
	| "submitFeedback" // 提交反馈/issue
	| "submitProject" // 申请软件专页
	| "submitLink" // 申请友链
	| "suggestDoc" // 纠正/建议文档
	| "submitIssue" // 提交故障工单 / Bug
	// ---- L2 起：班级/年级沟通（电教委员工作台） ----
	| "chatClass" // 在本班频道发言（电教委员日常对接）
	| "chatGrade" // 在本年级频道发言（年级电教委员群）
	| "readBroadcast" // 读取广播/公告（含设备端消息中心）
	// ---- L3 起：审核 ----
	| "createChannel" // 建立论坛频道
	| "moderate" // 审核 UGC（评论/反馈/论坛/申请）
	// ---- L3 起：广播 ----
	| "sendBroadcast" // 发布校/年级广播（含推送到教室大屏）
	// ---- L4 起：内容与后台 ----
	| "manageContent" // 管理博客/项目/文档（CRUD）
	| "managePages" // 页面编辑与美术设计（独立编辑器）
	| "manageFiles" // 文件/媒体管理
	| "manageFeeds" // 管理 RSS/内容源（聚合推送的源配置）
	| "viewAdmin" // 进入后台管理台
	// ---- L5：治理 ----
	| "manageUsers" // 用户与角色管理
	| "manageSettings" // 站点设置
	| "managePermissions" // 查看/调整权限矩阵
	| "manageDevices"; // 全量设备管理（与 device.manage 等价，保留旧名）

/** 一个动作所需的最低等级。can(role, action) 即「角色等级 ≥ 此值」。 */
const LEVEL_OF_ACTION: Record<Action, Level> = {
	viewConsole: 1,
	comment: 2,
	postForum: 2,
	submitFeedback: 2,
	submitProject: 2,
	submitLink: 2,
	suggestDoc: 2,
	submitIssue: 2,
	// 沟通：注册即可读，发本班言是 L2；跨年级群发言收紧到 L2（同班/同年级由业务层再校验）
	readBroadcast: 2,
	chatClass: 2,
	chatGrade: 2,
	createChannel: 3,
	moderate: 3,
	// 广播：发布是治理动作，收紧到 L3（审核员起），避免任意注册用户向全校大屏推送
	sendBroadcast: 3,
	manageContent: 4,
	managePages: 4,
	manageFiles: 4,
	manageFeeds: 4,
	viewAdmin: 4,
	manageUsers: 5,
	manageSettings: 5,
	managePermissions: 5,
	manageDevices: 5
};

/**
 * 各角色对应的等级。
 * owner 为本轮新增的「站长」规范名；admin 与之同等级（历史数据存的是 admin）。
 * techrep（电教委员）内容等级为 L2 —— 其特殊性在设备轴体现。
 */
const ROLE_LEVEL: Record<Role, Level> = {
	owner: 5,
	admin: 5,
	editor: 4,
	moderator: 3,
	user: 2,
	techrep: 2,
	viewer: 1
};

/**
 * 各角色在设备轴上持有的档位（默认档）。
 * 实际判定时业务层还会叠加条件（如同班/同年级校验）。
 */
const ROLE_DEVICE: Record<Role, DeviceTier[]> = {
	owner: ["watch", "control", "remote", "manage"],
	admin: ["watch", "control", "remote", "manage"],
	editor: ["watch", "control"],
	moderator: ["watch"],
	user: ["watch"],
	// 电教委员：设备能力强于其内容等级 —— 两条轴正交的意义所在
	techrep: ["watch", "control", "remote"],
	viewer: ["watch"]
};

/** 设备档位高低序（判定「包含」用）。 */
const DEVICE_RANK: Record<DeviceTier, number> = { watch: 0, control: 1, remote: 2, manage: 3 };

export const LEVEL_LABELS: Record<Level, string> = {
	1: "L1 访客",
	2: "L2 用户",
	3: "L3 审核员",
	4: "L4 编辑",
	5: "L5 站长"
};

export const LEVEL_DESCRIPTIONS: Record<Level, string> = {
	1: "只读：浏览公开内容；如获授权可只读查看集控面板",
	2: "参与：评论、发帖、反馈、申请友链与专页、文档纠错",
	3: "审核：在 L2 之上审核评论/论坛/申请，创建论坛频道",
	4: "编辑：在 L3 之上管理内容、页面与媒体，可进入后台",
	5: "站长：在 L4 之上管理用户、权限与站点设置，含全量设备"
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

/** 角色 -> 等级。未登录返回 null。 */
export function roleToLevel(role: Role | null | undefined): Level | null {
	if (!role) return null;
	return ROLE_LEVEL[role] ?? null;
}

/** 角色 -> 设备档位（默认档）。 */
export function roleDeviceTiers(role: Role | null | undefined): DeviceTier[] {
	if (!role) return [];
	return ROLE_DEVICE[role] ?? [];
}

/** 等级轴权限判定。未登录一律 false。 */
export function can(role: Role | null | undefined, action: Action): boolean {
	const level = roleToLevel(role);
	if (level === null) return false;
	const need = LEVEL_OF_ACTION[action];
	if (need === undefined) return false;
	return level >= need;
}

/**
 * 设备轴权限判定。
 * 语义是「包含」：持 remote 的角色自动拥有 control 与 watch ——
 * 远程控制天然涵盖锁屏/重启这类较弱操作。
 * 集控面板下发的权限位（control/remote/manage/issue）由此统一推导。
 */
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

/** 角色的中文标签。owner/admin 都显示「站长」，避免两个"最高权限"名目。 */
export const ROLE_LABELS: Record<Role, string> = {
	owner: "站长",
	admin: "站长",
	editor: "编辑",
	moderator: "审核员",
	user: "注册用户",
	techrep: "电教委员",
	viewer: "只读"
};

/** 角色的等级标签（UI 上「L4 编辑」这类展示）。 */
export function roleLevelLabel(role: Role | null | undefined): string {
	const lv = roleToLevel(role);
	return lv === null ? "未登录" : LEVEL_LABELS[lv];
}

/** 可分配角色清单，按等级从高到低（用户管理下拉复用）。 */
export const ASSIGNABLE_ROLES: Role[] = ["admin", "owner", "editor", "moderator", "techrep", "user", "viewer"];

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

/** 按等级归组的能力清单（权限矩阵页按行渲染）。 */
export function capabilitiesByLevel(): { level: Level; actions: Action[] }[] {
	const levels: Level[] = [1, 2, 3, 4, 5];
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
	3: "moderator",
	4: "editor",
	5: "admin"
};
