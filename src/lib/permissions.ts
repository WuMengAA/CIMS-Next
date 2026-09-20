// 统一权限模型：纯函数，前后端通用（无 server-only 依赖）。
//
// ── 两条互相独立的权限轴 ────────────────────────────────────────────────────
//
//  1) 纵向「等级轴」LEVEL —— 内容与平台治理能力，**六等**，从低到高：
//       L1 游客        viewer    只读浏览公开内容；**一律禁止进入集控面板与后台**
//       L2 学生        user      参与：评论、发帖、反馈、申请、纠错
//       L3 电教委员    techrep   在 L2 之上进入集控（本班设备运维主力）
//       L4 老师        teacher   在 L3 之上发本年级广播、带班管理
//       L5 审核 / 编辑 moderator / editor   在 L4 之上审核 UGC 与内容/页面/媒体管理，可进后台
//       L6 管理 / 站长 admin / owner        在 L5 之上管理用户、权限、站点设置
//
//      ⚠️ 等级轴是**累积偏序**：高等级自动具备低等级的全部能力（can 用 level >= need）。
//      所以往矩阵里插新等级时，必须复核「原有角色等级平移后是否被动获得新能力」——
//      本轮 L2→L3→L6 平移即触发了三处必须同步收紧/上移的动作（见 LEVEL_OF_ACTION 注释）。
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

/** 六级纵向等级。数值越大权限越高。 */
export type Level = 1 | 2 | 3 | 4 | 5 | 6;

/** 角色标识（数据库存的仍是这些值，保持向后兼容）。 */
export type Role =
	| "owner"
	| "admin"
	| "editor"
	| "moderator"
	| "teacher"
	| "user"
	| "techrep"
	| "viewer";

/** 设备操作敏感度轴（横向，独立于等级）。 */
export type DeviceTier = "watch" | "control" | "remote" | "manage";

/** 内容 / 平台动作（纵向能力清单）。 */
export type Action =
	// ---- L3 起：集控（可进面板）----
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
	// ---- L4 起：广播 ----
	| "sendBroadcast" // 发布校/年级广播（含推送到教室大屏）
	// ---- L5 起：审核 / 内容与后台 ----
	| "createChannel" // 建立论坛频道
	| "moderate" // 审核 UGC（评论/反馈/论坛/申请）
	| "reviewPermission" // 审核他人的权限晋升申请（逐级晋升的批准权）
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
	// ⚠️ 集控门槛 2026-09-20 从 L2 提到 **L3**：
	// 等级谱系本轮由五等扩到六等（原「L2 注册用户」拆成 L2 学生 / L3 电教委员），
	// 沿用 L2 就等于让**学生**直入集控 —— 集控是可锁屏/重启/远控教室设备的管理面，
	// 不该对学生开放。定 L3 后电教委员仍是设备操作主力（持 remote 档），设计意图不变，
	// 只是把「普通注册用户」挡在门外。
	viewConsole: 3,
	comment: 2,
	postForum: 2,
	submitFeedback: 2,
	submitProject: 2,
	submitLink: 2,
	suggestDoc: 2,
	submitIssue: 2,
	// 沟通：注册即可读；发本班/年级言由业务层再按班级归属校验
	readBroadcast: 2,
	chatClass: 2,
	chatGrade: 2,
	// ⚠️ 广播 2026-09-20 从 L3 提到 **L4**：techrep 本轮由 L2 升到 L3，
	// 若广播仍留在 L3，电教委员会**被动获得**向全校大屏推送的能力
	// （等级轴是累积偏序：高等级自动具备低等级全部能力）。
	// 提到 L4 后只有老师及以上可发；实际能发多远另由 broadcastScope 收敛。
	sendBroadcast: 4,
	// ⚠️ 审核 2026-09-20 从 L3 提到 **L5**：同上，techrep 升到 L3 会连带拿到 UGC 审核权。
	// 与 reviewPermission 同档，保证「审核」职能集中在 L5 一处。
	moderate: 5,
	createChannel: 5,
	// #181 逐级晋升：批准他人的权限晋升申请。与 UGC 审核同档（L5），
	// 避免 L3/L4 自行放权。
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

/**
 * 各角色对应的等级（六级谱系：游客 / 学生 / 电教委员 / 老师 / 审核·编辑 / 管理·站长）。
 *
 * ⚠️ 2026-09-20 由五等扩到六等时，techrep 2→3、moderator 3→5、admin/owner 5→6。
 * 等级轴是**累积偏序**，数值平移会让角色被动获得新能力，本文件已在
 * LEVEL_OF_ACTION 里同步把 viewConsole→3、sendBroadcast→4、moderate/createChannel→5
 * 上移，确保 techrep(3) 不会连带拿到审核与全校广播。改动此表时务必复核同一件事。
 */
const ROLE_LEVEL: Record<Role, Level> = {
	owner: 6,
	admin: 6,
	// 审核与编辑同为 L5：都是「平台职能岗」，高于老师（教学岗）
	editor: 5,
	moderator: 5,
	teacher: 4,
	techrep: 3,
	user: 2,
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
	// 老师：带班管理，看+控制本班/本年级设备；远控仍留在电教委员与校级手上
	teacher: ["watch", "control"],
	user: ["watch"],
	// 电教委员：设备能力强于其内容等级 —— 两条轴正交的意义所在
	techrep: ["watch", "control", "remote"],
	viewer: ["watch"]
};

/** 设备档位高低序（判定「包含」用）。 */
const DEVICE_RANK: Record<DeviceTier, number> = { watch: 0, control: 1, remote: 2, manage: 3 };

export const LEVEL_LABELS: Record<Level, string> = {
	1: "L1 游客",
	2: "L2 学生",
	3: "L3 电教委员",
	4: "L4 老师",
	5: "L5 审核·编辑",
	6: "L6 管理·站长"
};

export const LEVEL_DESCRIPTIONS: Record<Level, string> = {
	1: "只读：浏览公开内容（游客一律禁止进入集控面板与后台）",
	2: "参与：评论、发帖、反馈、申请友链与专页、文档纠错",
	3: "电教委员：在 L2 之上进入集控面板，运维本班设备（锁屏/截图/远控本班）",
	4: "老师：在 L3 之上带班管理、发本年级广播",
	5: "审核·编辑：在 L4 之上审核 UGC 与权限申请，管理内容/页面/媒体，可进入后台",
	6: "管理·站长：在 L5 之上管理用户、权限与站点设置，含全量设备"
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

// ── 广播可达范围（广播的第三个维度：能发 ≠ 能发多远）────────────────────────
//
// 「能广播」和「能广播到多大范围」是两件事，历史上混为一谈：
// 只要拿到 sendBroadcast / 设备轴 control，就能向**全校**大屏推消息 ——
// 于是一个班的电教委员喊一句话，全校所有教室的屏幕同时弹出来。
// 这里把范围拆成独立档位，按内容等级收敛：
//
//   L2 学生 / L3 电教委员  → class  仅本班
//   L4 老师 / L5 审核员    → grade  本年级
//   L5 编辑 / L6 管理·站长 → school 全校
//
// ⚠️ 本档位**按角色显式指定**（ROLE_SCOPE），不按等级阈值推导：等级扩到六等后
// 「编辑」与「审核」同在 L5 但能发范围不同（编辑=全校、审核=本年级），阈值推导
// 表达不了这种差异；而扩级时的数值平移会静默改变每个人的广播范围。
// 角色表驱动 → 扩级零副作用。
//
// 与设备轴的关系：设备轴 control 决定「能不能下发」，本档位决定「能下发给谁」。
// 两者都要过（见 /api/console/ext 的 notices 分支）。

/** 广播可达范围。 */
export type BroadcastScope = "class" | "grade" | "school";

const SCOPE_RANK: Record<BroadcastScope, number> = { class: 0, grade: 1, school: 2 };

export const BROADCAST_SCOPE_LABELS: Record<BroadcastScope, string> = {
	class: "本班",
	grade: "本年级",
	school: "全校"
};

/** 角色 → 广播可达范围（null = 完全不能广播）。 */
const ROLE_SCOPE: Record<Role, BroadcastScope | null> = {
	owner: "school",
	admin: "school",
	editor: "school",
	moderator: "grade",
	teacher: "grade",
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

/**
 * 把界面上的范围文案归一成档位。
 * 无法识别时按**最严**的 class 处理 —— 认不出来就不给更大的范围，
 * 避免新增一个文案就把权限放开。
 */
export function scopeFromLabel(label: unknown): BroadcastScope {
	const s = String(label ?? "").trim();
	if (s.includes("全校") || s.includes("广播")) return "school";
	if (s.includes("年级")) return "grade";
	return "class";
}

/** 角色可选的广播范围清单（面板下拉用，只列有权限的档位）。 */
export function allowedBroadcastScopes(role: Role | null | undefined): BroadcastScope[] {
	const max = broadcastScope(role);
	if (!max) return [];
	return (["class", "grade", "school"] as BroadcastScope[]).filter((s) => SCOPE_RANK[s] <= SCOPE_RANK[max]);
}

/**
 * 把「想要的范围」收敛到角色上限之内。
 *
 * 用于「事件本身自带范围、但发起人权限不够」的场景：例如电教委员在全校群里
 * 喊 @全体 —— 事件语义是全校，但他只能发本班，于是收敛为 class，
 * 而不是直接拒绝（拒绝会让互助功能对 L2 完全不可用），
 * 也不是照发全校（那等于权限形同虚设）。
 *
 * 返回 null 表示完全不能广播。
 */
export function clampBroadcastScope(
	role: Role | null | undefined,
	want: BroadcastScope
): BroadcastScope | null {
	const max = broadcastScope(role);
	if (!max) return null;
	return SCOPE_RANK[max] >= SCOPE_RANK[want] ? want : max;
}

/** 角色的中文标签。owner/admin 都显示「站长」，避免两个"最高权限"名目。 */
export const ROLE_LABELS: Record<Role, string> = {
	owner: "站长",
	admin: "站长",
	editor: "编辑",
	moderator: "审核员",
	teacher: "老师",
	user: "学生",
	techrep: "电教委员",
	viewer: "游客"
};

/** 角色的等级标签（UI 上「L4 编辑」这类展示）。 */
export function roleLevelLabel(role: Role | null | undefined): string {
	const lv = roleToLevel(role);
	return lv === null ? "未登录" : LEVEL_LABELS[lv];
}

// ── 权限晋升申请的「能力证明」目录（#181）──────────────────────────────────
//
// 放在 permissions.ts（纯模块，前后端都能 import）而不是 `$lib/server/role-requests.ts`：
// 申请页与后台审核页都要渲染这份清单，而 `$lib/server/*` 一旦被客户端组件 import
// 就会把服务端依赖（SQLite / fs）拖进浏览器包，构建期直接失败。
// 服务端校验也复用这份清单，保证「下拉里能选的」与「服务端认的」永远一致。
export const PROOF_TYPES: { key: string; label: string; hint: string }[] = [
	{ key: "teacher_id", label: "教师工号 / 教工证", hint: "填写工号或证件编号，审核时会与学校名单核对" },
	{ key: "class_device", label: "班级设备编号", hint: "教室一体机 / ClassIsland 设备码（如 lab-pc-001）" },
	{ key: "school_email", label: "学校邮箱", hint: "以学校域名结尾的邮箱地址（如 @xxx.edu.cn）" },
	{ key: "work_order", label: "集控工单记录", hint: "你在集控里处理过的故障工单编号或时间" },
	{ key: "vouch", label: "现任管理员推荐", hint: "推荐人的用户名，审核时会向本人确认" }
];

/** 证明类型的取值集合（服务端白名单校验用）。 */
export const PROOF_TYPE_KEYS: string[] = PROOF_TYPES.map((p) => p.key);

/** 证明类型 -> 中文标签（列表页直接展示）。 */
export const PROOF_TYPE_LABELS: Record<string, string> = Object.fromEntries(
	PROOF_TYPES.map((p) => [p.key, p.label])
);

// ── 管理分级（组织层：谁管谁）──────────────────────────────────────────────
//
// 与「等级轴 / 设备轴 / 广播范围轴」的区别：那三条回答「能做什么」，
// 本层回答「管到哪一级」。三档自下而上收拢：
//
//   class  班级电教委员  管本班设备（锁屏/截图/远控本班）、发本班广播、本班交流
//   grade  年级管理员    管本年级各班（审核本年级内容、发本年级广播）
//   school 校级管理员    管全校（用户、设备、策略、全校广播）
//
// 关键约束（防越权三条）：
//   ① 分级是**上限**不是授权 —— 校级管理员若无 device.remote，仍不能远控；
//      分级只用来把「可视范围」和「广播范围」收窄，不会凭空给能力。
//   ② 班级电教委员**不能跨班**：其广播范围与设备可见范围都锁在本班
//      （服务端另有同班校验，见 console-ext 的 chat/notices 分支）。
//   ③ 年级管理员看本年级：靠 gradeName 匹配，而不是靠角色名信任客户端。

/** 管理分级。 */
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

/**
 * 角色对应的管理分级。
 *
 * techrep（电教委员）是本层存在的理由：它内容等级只有 L2，却是**班级层**的
 * 实际运维人 —— 分级轴让它能管本班设备，同时被硬锁在本班之内。
 */
const ROLE_TIER: Record<Role, ManagementTier> = {
	owner: "school",
	admin: "school",
	editor: "school",
	moderator: "grade",
	// 老师管本年级（带班、审本年级内容、发本年级广播）
	teacher: "grade",
	techrep: "class",
	user: "class",
	viewer: "class"
};

/** 角色 → 管理分级。 */
export function roleManagementTier(role: Role | null | undefined): ManagementTier | null {
	if (!role) return null;
	return ROLE_TIER[role] ?? null;
}

/**
 * 该角色能管到的最大范围（与广播范围共用 class/grade/school 三档语义）。
 * 返回 null 表示无任何管理范围（未登录）。
 */
export function managementScope(role: Role | null | undefined): BroadcastScope | null {
	const t = roleManagementTier(role);
	return t ?? null;
}

/** 是否属于「班级层」——面板据此把跨班入口整体收起。 */
export function isClassScoped(role: Role | null | undefined): boolean {
	return roleManagementTier(role) === "class";
}

/**
 * 校验「操作者能否管理某个目标班级」。
 *
 * 三条规则：
 *   · 校级：任意班
 *   · 年级：同年级（按年级名前缀匹配，gradeName 由账号资料提供）
 *   · 班级：仅本班（按 classId 相等）
 *
 * 年级名匹配刻意用「前缀/包含」而不是严格相等：学校的年级名有
 * 「高一」/「高一年级」/「2026级高一」几种写法，严格相等会把一半人误判成越权。
 * 代价是把「高一」和「高一实验」视为同年级 —— 在本场景下可接受（都属高一年级）。
 */
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

/**
 * 把「目标范围」收敛到角色可管范围内。
 * 返回 null = 完全不可管（未登录）。
 */
export function clampManagementScope(
	role: Role | null | undefined,
	want: BroadcastScope
): BroadcastScope | null {
	const max = managementScope(role);
	if (!max) return null;
	return TIER_RANK[max] >= TIER_RANK[want] ? want : max;
}

export const ASSIGNABLE_TIERS: ManagementTier[] = ["class", "grade", "school"];

/**
 * 面板「权限与分级」页的完整快照（服务端算好后一次性下发）。
 *
 * 为什么由服务端算而不是前端算：等级/设备/分级三张表是**安全边界**的一部分，
 * 前端拿到的必须是"服务端认为你能做什么"，而不是"前端自己推导出你能做什么"。
 * 前端自行推导时，任何一处判断写错都会让界面显示超出实际权限的能力；
 * 服务端下发则始终与真正的门控逻辑（can/canDevice/canBroadcastTo）同源。
 */
export function permissionMatrix(role: Role | null | undefined) {
	const me = roleCapabilitiesSummary(role);
	const scope = broadcastScope(role);
	const tier = roleManagementTier(role);
	return {
		// 当前账号快照
		me: {
			role: role ?? null,
			roleLabel: role ? ROLE_LABELS[role] : "未登录",
			level: me.level,
			levelLabel: me.levelLabel,
			actions: me.actions,
			actionLabels: me.actions.map((a) => ACTION_LABELS[a]),
			deviceTiers: me.deviceTiers,
			isUserPlusDevice: me.isUserPlusDevice,
			managementTier: tier,
			managementTierLabel: tier ? MANAGEMENT_TIER_LABELS[tier] : "—",
			managementTierDescription: tier ? MANAGEMENT_TIER_DESCRIPTIONS[tier] : "",
			broadcastScopes: allowedBroadcastScopes(role),
			broadcastScopeLabel: scope ? BROADCAST_SCOPE_LABELS[scope] : "不可广播",
			canManageClassScope: scope === "class",
			canManageGrade: tier === "grade",
			canManageSchool: tier === "school"
		},
		// 等级轴
		levels: capabilitiesByLevel().map((g) => ({
			level: g.level,
			label: LEVEL_LABELS[g.level],
			description: LEVEL_DESCRIPTIONS[g.level],
			sampleRole: LEVEL_SAMPLE_ROLE[g.level],
			actions: g.actions.map((a) => ({ key: a, label: ACTION_LABELS[a] }))
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

/** 按等级归组的能力清单（权限矩阵页按行渲染）。 */
export function capabilitiesByLevel(): { level: Level; actions: Action[] }[] {
	// ⚠️ 等级清单必须与 ROLE_LEVEL / LEVEL_LABELS 的**全集**一致。
	// 历史 bug：六等扩级时这里漏改成 [1..5]，于是矩阵页永远少一行 L6 ——
	// 「管理·站长」那一行的能力全靠脑补。新增等级时请同步这里与
	// `_probe/permissions-invariants.mjs` 的「矩阵覆盖全部等级」不变量。
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
 * 角色能力摘要（用于界面直观展示「权限叠加」）。
 *
 * 设计原则：**权限是一个个叠加上去的**——高等级自动继承低等级的全部能力，
 * 设备轴（横向）再叠加在内容等级（纵向）之上。例：电教委员（techrep）本质就是
 * 「学生(L2) 的全部能力 + 设备操作权限」，并非一个与学生并列的独立类别；
 * 因此它能评论、发帖、申请，只是额外持 remote 设备档位。
 */
export function roleCapabilitiesSummary(role: Role | null | undefined): {
	level: Level | null;
	levelLabel: string;
	actions: Action[];
	deviceTiers: DeviceTier[];
	isUserPlusDevice: boolean;
} {
	const lv = roleToLevel(role);
	const actions = lv ? (Object.keys(LEVEL_OF_ACTION) as Action[]).filter((a) => LEVEL_OF_ACTION[a] <= lv) : [];
	return {
		level: lv,
		levelLabel: lv === null ? "未登录" : LEVEL_LABELS[lv],
		actions,
		deviceTiers: roleDeviceTiers(role),
		// 电教委员 = 用户（L2）能力 + 设备权限（叠加，而非替代）
		isUserPlusDevice: role === "techrep"
	};
}
