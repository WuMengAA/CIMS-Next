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
//   - 经验等级（#248 之后：Lv.1~Lv.6，由 `xp` 经验值推导）只用于 UI 展示「参与程度」，
//     与权限、与角色**零耦合**——例如「Lv.6 传奇」的游客也只是游客，权限不变。
//   - 角色秩（ROLE_RANK，1~6）只用于「权限晋升」的有序性校验，不叫等级、不参与判定。
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

/** 六级纵向经验等级（#248：由 xp 经验值推导，纯展示，不参与任何权限判定，与角色零耦合）。 */
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

/**
 * 设备**动作**轴（2026-09-25 班级系统 v2，用户逐角色口述定死）：
 * 老的 DeviceTier 回答「敏感度多高」，这一轴回答「具体能做什么事」，
 * 并与「班级范围」正交（范围见 CLASS_BIND_LIMITS / class-scope.ts）。
 *   watch    监控（看设备画面/状态）
 *   playback 监控视频回放（翻历史截图时间线）
 *   remote   远控（锁屏/重启/音量/切课表等本机控制）
 *   voice    发语音（推送音频到教室播放）
 *   notify   发通知（定向班级通知/广播）
 *   file     传文件（上传并推送到教室）
 *   shutdown 关机（**仅学校管理员**；含 reboot 同级危险动作）
 */
export type DeviceAction =
	| "watch"
	| "playback"
	| "remote"
	| "voice"
	| "notify"
	| "file"
	| "shutdown";

export const DEVICE_ACTION_LABELS: Record<DeviceAction, string> = {
	watch: "监控",
	playback: "监控回放",
	remote: "远控",
	voice: "发语音",
	notify: "发通知",
	file: "传文件",
	shutdown: "关机"
};

/**
 * 角色 → 设备动作表（v2 权威矩阵，与用户 2026-09-25 口述逐格对齐）：
 *   学校管理员（owner/admin）→ 全部动作，不绑班（范围=全校）；
 *   班主任 homeroom → 远控/监控/回放/语音/通知/传文件（恰好 1 班）；
 *   老师 teacher → 传文件（≤2 班）；
 *   电教委员 techrep → 电教委员面板（viewConsole 称号）+ 传文件（1 班）；
 *   user / viewer / editor / moderator → 一律无设备动作（双重严禁里的后端半边）。
 */
const ROLE_DEVICE_ACTIONS: Record<Role, DeviceAction[]> = {
	owner: ["watch", "playback", "remote", "voice", "notify", "file", "shutdown"],
	admin: ["watch", "playback", "remote", "voice", "notify", "file", "shutdown"],
	homeroom: ["watch", "playback", "remote", "voice", "notify", "file"],
	teacher: ["file"],
	techrep: ["file"],
	editor: [],
	moderator: [],
	user: [],
	viewer: []
};

/** 设备动作判定（纯函数；班级范围由 class-scope.ts 叠加，这里只看角色）。 */
export function canDeviceAction(role: Role | null | undefined, action: DeviceAction): boolean {
	if (!role) return false;
	return (ROLE_DEVICE_ACTIONS[role] ?? []).includes(action);
}

/** 某角色的全部设备动作（面板按它渲染按钮；服务端按它逐请求强制）。 */
export function deviceActionsOf(role: Role | null | undefined): DeviceAction[] {
	if (!role) return [];
	return [...(ROLE_DEVICE_ACTIONS[role] ?? [])];
}

/**
 * 通知类型（v2 通知类型化，2026-09-25）：与 DeviceAction 正交的第二维——
 * 「能不能发**这种形态**的通知」。服务端逐请求强制；面板按它渲染类型选项。
 *   notice     普通公告（旧行为，历史兼容）
 *   island     岛通知：大屏滚动循环展示，非打断（老师也能发本班上课提醒）
 *   popup      弹窗通知：需确认 / 可回复（打断课堂，班主任级以上才能发）
 *   fullscreen 全屏紧急通知：置顶屏幕上方（强打断，**仅学校管理员**）
 * 关闭原则：旧客户端/旧通道收到的 type 一律按 notice 处理，绝不因新字段误伤历史。
 */
export type NoticeType = "notice" | "island" | "popup" | "fullscreen";

export const NOTICE_TYPE_LABELS: Record<NoticeType, string> = {
	notice: "普通公告",
	island: "岛通知循环",
	popup: "弹窗确认/回复",
	fullscreen: "全屏紧急"
};

const ROLE_NOTICE_TYPES: Record<Role, NoticeType[]> = {
	owner: ["notice", "island", "popup", "fullscreen"],
	admin: ["notice", "island", "popup", "fullscreen"],
	homeroom: ["notice", "island", "popup"],
	teacher: ["notice", "island"],
	techrep: [],
	editor: [],
	moderator: [],
	user: [],
	viewer: []
};

/** 通知类型判定（纯函数；班级范围由 class-scope 叠加）。 */
export function canSendNoticeType(role: Role | null | undefined, type: NoticeType): boolean {
	if (!role) return false;
	return (ROLE_NOTICE_TYPES[role] ?? []).includes(type);
}

/** 某角色可用的通知类型（面板渲染类型下拉用）。 */
export function noticeTypesOf(role: Role | null | undefined): NoticeType[] {
	if (!role) return [];
	return [...(ROLE_NOTICE_TYPES[role] ?? [])];
}

/**
 * 能力位（功能开关，2026-09-26）：把「能不能发通知」这种粗粒度矩阵
 * 拆成**一个个可单独开合的功能点**。
 *
 * 三条设计约束：
 * 1. **裁决只在服务端**。这里的默认值只是"角色默认"，最终能力位由服务端
 *    `resolveUserFeatures()` 叠加 per-user 覆盖后下发；前端拿到的是结论，
 *    不是规则，改前端代码开不出任何功能。
 * 2. **覆盖值三态**：true=强制开 / false=强制关 / 缺省=按角色默认。
 *    所以可以给某位老师单独开「弹窗」，也可以单独掐掉某位管理员的「关机」，
 *    而不必改角色（角色一改，其他能力跟着全变）。
 * 3. **危险项默认收窄**：device_shutdown / notice_fullscreen 这类会打断课堂
 *    或关掉机器的，只给学校管理员默认开，其余一律 false。
 */
export type FeatureKey =
	| "notice_island"
	| "notice_popup"
	| "notice_fullscreen"
	| "notice_tts"
	| "notice_reply"
	| "screenshot"
	| "screenshot_upload"
	| "file_push"
	| "history_sidebar"
	| "device_restart"
	| "device_shutdown"
	| "watchdog";

export const FEATURE_KEYS: FeatureKey[] = [
	"notice_island",
	"notice_popup",
	"notice_fullscreen",
	"notice_tts",
	"notice_reply",
	"screenshot",
	"screenshot_upload",
	"file_push",
	"history_sidebar",
	"device_restart",
	"device_shutdown",
	"watchdog"
];

export const FEATURE_LABELS: Record<FeatureKey, string> = {
	notice_island: "岛通知（大屏循环）",
	notice_popup: "弹窗通知（需确认）",
	notice_fullscreen: "全屏紧急通知",
	notice_tts: "语音朗读（TTS）",
	notice_reply: "允许回复消息",
	screenshot: "远程截图",
	screenshot_upload: "截图回传查看",
	file_push: "文件下发",
	history_sidebar: "历史消息侧栏",
	device_restart: "重启设备",
	device_shutdown: "关闭设备",
	watchdog: "卡死自动重启"
};

/** 角色默认能力位（与 ROLE_DEVICE_ACTIONS / ROLE_NOTICE_TYPES 同源推导）。 */
const ROLE_FEATURES: Record<Role, Record<FeatureKey, boolean>> = {
	owner: {
		notice_island: true, notice_popup: true, notice_fullscreen: true, notice_tts: true,
		notice_reply: true, screenshot: true, screenshot_upload: true, file_push: true,
		history_sidebar: true, device_restart: true, device_shutdown: true, watchdog: true
	},
	admin: {
		notice_island: true, notice_popup: true, notice_fullscreen: true, notice_tts: true,
		notice_reply: true, screenshot: true, screenshot_upload: true, file_push: true,
		history_sidebar: true, device_restart: true, device_shutdown: true, watchdog: true
	},
	homeroom: {
		notice_island: true, notice_popup: true, notice_fullscreen: false, notice_tts: true,
		notice_reply: true, screenshot: true, screenshot_upload: true, file_push: true,
		history_sidebar: true, device_restart: true, device_shutdown: false, watchdog: true
	},
	teacher: {
		notice_island: true, notice_popup: false, notice_fullscreen: false, notice_tts: false,
		notice_reply: false, screenshot: false, screenshot_upload: false, file_push: true,
		history_sidebar: true, device_restart: false, device_shutdown: false, watchdog: false
	},
	techrep: {
		notice_island: false, notice_popup: false, notice_fullscreen: false, notice_tts: false,
		notice_reply: false, screenshot: false, screenshot_upload: false, file_push: true,
		history_sidebar: true, device_restart: false, device_shutdown: false, watchdog: false
	},
	editor: {
		notice_island: false, notice_popup: false, notice_fullscreen: false, notice_tts: false,
		notice_reply: false, screenshot: false, screenshot_upload: false, file_push: false,
		history_sidebar: false, device_restart: false, device_shutdown: false, watchdog: false
	},
	moderator: {
		notice_island: false, notice_popup: false, notice_fullscreen: false, notice_tts: false,
		notice_reply: false, screenshot: false, screenshot_upload: false, file_push: false,
		history_sidebar: false, device_restart: false, device_shutdown: false, watchdog: false
	},
	user: {
		notice_island: false, notice_popup: false, notice_fullscreen: false, notice_tts: false,
		notice_reply: false, screenshot: false, screenshot_upload: false, file_push: false,
		history_sidebar: false, device_restart: false, device_shutdown: false, watchdog: false
	},
	viewer: {
		notice_island: false, notice_popup: false, notice_fullscreen: false, notice_tts: false,
		notice_reply: false, screenshot: false, screenshot_upload: false, file_push: false,
		history_sidebar: false, device_restart: false, device_shutdown: false, watchdog: false
	}
};

/** 某角色的默认能力位（服务端叠加 per-user 覆盖前的基线）。 */
export function featureDefaultsOf(role: Role | null | undefined): Record<FeatureKey, boolean> {
	if (!role) return Object.fromEntries(FEATURE_KEYS.map((k) => [k, false])) as Record<FeatureKey, boolean>;
	return { ...(ROLE_FEATURES[role] ?? ROLE_FEATURES.user) };
}

/**
 * 叠加最终能力位：角色默认 + per-user 覆盖（true 强制开 / false 强制关）。
 *
 * 返回值里带 `overridden`，是为了让面板能显示"这条是单独给你开的/关的"——
 * 否则老师看到自己能发全屏通知会以为是所有老师都能，管理员也无从核对。
 */
export function resolveFeatures(
	role: Role | null | undefined,
	overrides?: Record<string, unknown> | null
): { features: Record<FeatureKey, boolean>; overridden: FeatureKey[] } {
	const base = featureDefaultsOf(role);
	const overridden: FeatureKey[] = [];
	const src = overrides && typeof overrides === "object" ? overrides : {};
	for (const k of FEATURE_KEYS) {
		const v = (src as Record<string, unknown>)[k];
		if (v === true || v === false) {
			base[k] = v;
			if (v !== featureDefaultsOf(role)[k]) overridden.push(k);
		}
	}
	return { features: base, overridden };
}

/**
 * 「用户 ↔ 班级」绑定上限（v2：必须绑定的三角色各有限额）。
 *   -1 = 不需要绑定（范围即全校，绑了也不作为权限依据）；
 *    0 = 禁止绑定（该角色没有任何设备/班级能力）；
 *   >0 = 最多可绑班数（也是下限要求：没绑定就没有班级范围，什么都推不了）。
 */
export const CLASS_BIND_LIMITS: Record<Role, number> = {
	owner: -1,
	admin: -1,
	homeroom: 1,
	teacher: 2,
	techrep: 1,
	editor: 0,
	moderator: 0,
	user: 0,
	viewer: 0
};

/** 该角色最多可绑班数（-1 = 无需绑定；0 = 禁止）。 */
export function classBindLimit(role: Role | null | undefined): number {
	if (!role) return 0;
	return CLASS_BIND_LIMITS[role] ?? 0;
}

/** 该角色是否「必须绑班才有班级范围」（teacher/homeroom/techrep）。 */
export function requiresClassBinding(role: Role | null | undefined): boolean {
	return classBindLimit(role) > 0;
}

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
	| "manageDevices" // 全量设备管理
	| "manageOAuth" // 管理第三方登录授权（客户端与密钥）
	| "manageStorage"; // 管理附件库与图床（跨账号占用、配额赠送、强制清理）

/** 称号键。权限的真正载体。 */
export type TitleKey =
	| "visitor"
	| "participant"
	| "techcommissioner"
	| "classTeacher"
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
		description: "进入集控面板（v2：设备动作只剩传文件，运维归班主任/站长）。",
		actions: ["viewConsole"]
	},
	classTeacher: {
		key: "classTeacher",
		label: "任课教师",
		description: "进入集控面板使用传文件等班级教学功能（≤2 班；不含监控与广播）。",
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
		actions: [
			"manageUsers",
			"manageSettings",
			"managePermissions",
			"manageDevices",
			"manageOAuth",
			"manageStorage",
			"viewConsole"
		]
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
	// v2（2026-09-25 用户矩阵）：电教委员 = 电教委员面板 + 传文件。
	// 设备轴动作清空（watch/control/remote 全收回）——「能碰设备」的收口在
	// ROLE_DEVICE_ACTIONS，面板可达性走 viewConsole 称号，两者正交。
	techrep: ["visitor", "participant", "techcommissioner"],
	// 班主任：进面板 + 参与者 + 广播员（发通知，范围收敛到本班，见 ROLE_SCOPE）。
	// 设备轴走独立正交轴（ROLE_DEVICE.homeroom = watch/control/remote），与内容称号无关。
	homeroom: ["visitor", "participant", "broadcaster"],
	// 老师（任课教师）v2：只保留传文件（≤2 班）——收回 sendBroadcast（发通知归班主任），
	// 新增 classTeacher 称号让它仍能进面板使用传文件界面。
	teacher: ["visitor", "participant", "classTeacher"],
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
 * 纵向「经验等级」标签（#248：纯展示，与权限/角色**零耦合**）。
 * ⚠️ 经验等级由 `xp`（经验值）推导，只回答「用了多久、参与多深」；
 * 不参与 `can()` 判定，也不映射任何角色——权限只来自称号（TITLES）。
 * 旧版「L1 游客 … L6 站长」的等级=角色标签已被废弃（#248 彻底解耦）。
 */
export const LEVEL_LABELS: Record<Level, string> = {
	1: "Lv.1 新芽",
	2: "Lv.2 新秀",
	3: "Lv.3 骨干",
	4: "Lv.4 精英",
	5: "Lv.5 达人",
	6: "Lv.6 传奇"
};

export const LEVEL_DESCRIPTIONS: Record<Level, string> = {
	1: "起步阶段，继续积累使用经验吧。",
	2: "已开始活跃，经验值在稳步累积。",
	3: "平台常客，参与度日渐加深。",
	4: "深度使用者，经验值不断攀升。",
	5: "资深用户，离最高荣誉仅一步之遥。",
	6: "最高荣誉——经验与贡献的见证。"
};

/**
 * 经验值 → 等级阈值表（[达到该值即升到该档]）。纯展示，不参与任何权限判定。
 * 阈值：0 → Lv.1，100 → Lv.2，300 → Lv.3，600 → Lv.4，1000 → Lv.5，1500 → Lv.6。
 */
export const XP_THRESHOLDS: [number, Level][] = [
	[0, 1],
	[100, 2],
	[300, 3],
	[600, 4],
	[1000, 5],
	[1500, 6]
];

/** 经验值 → 经验等级（纯函数；非法/负数按 0 处理）。 */
export function xpToLevel(xp: number): Level {
	const n = Number.isFinite(xp) ? Math.max(0, Math.floor(xp)) : 0;
	let lv: Level = 1;
	for (const [t, l] of XP_THRESHOLDS) if (n >= t) lv = l;
	return lv;
}

/** 经验等级的中文标签（「Lv.3 骨干」）。 */
export function levelLabelOfXp(xp: number): string {
	return LEVEL_LABELS[xpToLevel(xp)];
}

/** 经验等级的描述。 */
export function levelDescriptionOfXp(xp: number): string {
	return LEVEL_DESCRIPTIONS[xpToLevel(xp)];
}

/** 距下一档还差多少经验（已满级返回 0）。 */
export function xpToNextLevel(xp: number): number {
	const lv = xpToLevel(xp);
	if (lv >= 6) return 0;
	const next = XP_THRESHOLDS.find(([, l]) => l === (lv + 1) as Level);
	const n = Number.isFinite(xp) ? Math.max(0, Math.floor(xp)) : 0;
	return next ? Math.max(0, next[0] - n) : 0;
}

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

/**
 * 角色秩（1–6）：**只用于「权限晋升」的有序性校验与角色排序**，不是等级。
 * 经验等级（xp→Lv）才是显示用的等级；角色秩回答的是「谁在权限链上更高」，
 * 与经验值、与展示等级完全无关（#248 解耦后等级=经验，权限链=角色秩）。
 * 例：admin/owner 秩 6 > editor/moderator 秩 5 > teacher/homeroom 秩 4 > techrep 秩 3。
 */
export const ROLE_RANK: Record<Role, number> = {
	viewer: 1,
	user: 2,
	techrep: 3,
	teacher: 4,
	homeroom: 4,
	moderator: 5,
	editor: 5,
	admin: 6,
	owner: 6
};

/** 角色秩（未知/未登录 = 0）。 */
export function roleRank(role: Role | null | undefined): number {
	if (!role) return 0;
	return ROLE_RANK[role] ?? 0;
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
	// ⚠️ 设备三关（#249）已被 v2 矩阵（2026-09-25）取代并收紧：
	// 「能碰设备」的粗档只剩 站长(owner/admin) / 班主任(homeroom)；
	// 老师/电教委员的设备动作收口到 ROLE_DEVICE_ACTIONS（都只剩传文件），
	// 传文件走网站 ext 端点（服务端代推），**不经过**这条代理粗档 ——
	// 因此它们在这里必须清空：设备列表一条不给、代理指令一条不发。
	editor: [],
	moderator: [],
	teacher: [],
	user: [],
	techrep: [],
	// 班主任：本班设备全部粗档（远控/监控）；本班归属由代理层按绑定班级收敛。
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
	// v2（2026-09-25 用户矩阵）：发通知收归班主任，老师只传文件 → 不能广播。
	teacher: null,
	// 班主任：发通知只到**本班**（1 个班；旧方案的本班·年级广播被 v2 收紧）。
	homeroom: "class",
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

// ── 角色能力摘要 / 权限矩阵（#248：矩阵不再出现「等级」，等级=经验，与权限无关）────────

/** 角色能力摘要（用于界面直观展示）。actions 现由称号并集推导。 */
export function roleCapabilitiesSummary(role: Role | null | undefined): {
	roleLabel: string;
	actions: Action[];
	deviceTiers: DeviceTier[];
	isUserPlusDevice: boolean;
} {
	const actions = Array.from(actionsOfTitles(titlesOf(role)));
	return {
		roleLabel: role ? ROLE_LABELS[role] : "未登录",
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
 * @param user 可传用户对象（含显式称号 `titles`、经验值 `xp`）或纯角色。
 *   传用户对象时 me 快照会反映**实际生效**的称号（覆盖写优先）与**该用户的经验等级**
 *   （xp→Lv，与角色无关）；传纯角色时退化为角色预设（xp 按 0 计 = Lv.1）。
 */
export function permissionMatrix(
	user: { role?: Role | null; titles?: TitleKey[] | null; xp?: number | null } | Role | null | undefined
) {
	const role = (typeof user === "object" && user !== null ? user.role : user) ?? null;
	const xp = typeof user === "object" && user !== null && user.xp != null ? Number(user.xp) || 0 : 0;
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
			// 经验等级（#248：与角色零耦合）—— xp → Lv，权限仍只看称号。
			xp,
			level: xpToLevel(xp),
			levelLabel: levelLabelOfXp(xp),
			levelDescription: levelDescriptionOfXp(xp),
			xpToNext: xpToNextLevel(xp),
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
		// 称号目录（权限的真实载体，供面板展示「我的称号」）—— 权限矩阵不再按等级分轴
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
			// 去重：admin/owner 同标「站长」等历史冗余，矩阵不重复展示（UI 层，不改角色语义）
			roles: uniqStrings((Object.keys(ROLE_LABELS) as Role[]).filter((r) => canDevice(r, t)).map((r) => ROLE_LABELS[r]))
		})),
		// 分级轴
		managementTiers: ASSIGNABLE_TIERS.map((t) => ({
			key: t,
			label: MANAGEMENT_TIER_LABELS[t],
			description: MANAGEMENT_TIER_DESCRIPTIONS[t],
			roles: uniqStrings(
				(Object.keys(ROLE_LABELS) as Role[])
					.filter((r) => roleManagementTier(r) === t)
					.map((r) => ROLE_LABELS[r])
			)
		})),
		// 广播范围轴
		broadcastScopes: (["class", "grade", "school"] as BroadcastScope[]).map((s) => ({
			key: s,
			label: BROADCAST_SCOPE_LABELS[s],
			roles: uniqStrings(
				(Object.keys(ROLE_LABELS) as Role[])
					.filter((r) => canBroadcastTo(r, s))
					.map((r) => ROLE_LABELS[r])
			)
		})),
		// 全部角色（面板做"角色 → 能力"对照表；rank=角色秩，仅排序用，非等级）
		roles: dedupeByLabel(
			ASSIGNABLE_ROLES.map((r) => {
				const s = broadcastScope(r);
				const t = roleManagementTier(r);
				return {
					key: r,
					label: ROLE_LABELS[r],
					rank: roleRank(r),
					titles: titlesOf(r),
					titleLabels: titlesOf(r).map((tt) => TITLES[tt].label),
					deviceTiers: roleDeviceTiers(r),
					managementTier: t,
					managementTierLabel: t ? MANAGEMENT_TIER_LABELS[t] : "—",
					broadcastScope: s,
					broadcastScopeLabel: s ? BROADCAST_SCOPE_LABELS[s] : "不可广播"
				};
			})
		)
	};
}

/** 字符串数组去重（保持原顺序，保留首次出现）。 */
function uniqStrings(arr: string[]): string[] {
	return [...new Set(arr)];
}

/**
 * 按 label 去重（保持原顺序，保留首次出现）。
 * 用于权限矩阵的「角色 → 能力」对照表：admin/owner 是历史上功能完全等价的
 * 两个角色标识（标签同为「站长」），DB 里存量账号两个值都可能有，不能合并，
 * 但展示层不应出现两行无法区分的「站长」，故同标签只展示第一个。
 */
function dedupeByLabel<T extends { label: string }>(arr: T[]): T[] {
	const seen = new Set<string>();
	return arr.filter((x) => {
		if (seen.has(x.label)) return false;
		seen.add(x.label);
		return true;
	});
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
	manageDevices: "全量设备管理",
	manageOAuth: "第三方登录授权",
	manageStorage: "附件库 / 图床管理"
};

/** 某角色在矩阵中的能力快照（矩阵页逐格打勾）。 */
export function hasAction(role: Role, action: Action): boolean {
	return can(role, action);
}

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
