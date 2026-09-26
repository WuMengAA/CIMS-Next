// 权限矩阵不变量回归（一次性探针，验证 Lv1–Lv6 扩级后无「能力被动放大」）。
// 运行：node --experimental-strip-types _probe/permissions-invariants.mjs
import * as P from "../src/lib/permissions.ts";

const checks = [];
const c = (name, ok) => checks.push([name, !!ok]);

// ---- 1. 六级谱系映射 ----
c("viewer = L1", P.roleToLevel("viewer") === 1);
c("user = L2", P.roleToLevel("user") === 2);
c("techrep = L3", P.roleToLevel("techrep") === 3);
c("teacher = L4", P.roleToLevel("teacher") === 4);
c("moderator = L5", P.roleToLevel("moderator") === 5);
c("editor = L5", P.roleToLevel("editor") === 5);
c("admin = L6", P.roleToLevel("admin") === 6);
c("owner = L6", P.roleToLevel("owner") === 6);

// ---- 2. 防「等级平移导致的被动放大」：techrep 2→3 后不得拿到原 L3 能力 ----
c("techrep 不能 moderate", !P.can("techrep", "moderate"));
c("techrep 不能 createChannel", !P.can("techrep", "createChannel"));
c("techrep 不能 sendBroadcast", !P.can("techrep", "sendBroadcast"));
c("techrep 不能 reviewPermission", !P.can("techrep", "reviewPermission"));
c("techrep 不能进后台", !P.can("techrep", "viewAdmin"));
c("techrep 能进集控（设计意图）", P.can("techrep", "viewConsole"));
c("techrep 能远控（设备轴）", P.canDevice("techrep", "remote"));
c("techrep 无 manage 设备档", !P.canDevice("techrep", "manage"));

// ---- 3. 学生（L2）收紧：集控门槛 L2→L3 ----
c("user 不能进集控", !P.can("user", "viewConsole"));
c("user 能评论", P.can("user", "comment"));
c("user 广播仅本班", P.broadcastScope("user") === "class");
c("viewer 不能评论", !P.can("viewer", "comment"));
c("viewer 不能进集控", !P.can("viewer", "viewConsole"));
c("viewer 不能广播", P.broadcastScope("viewer") === null);

// ---- 4. 老师（L4，新角色）----
c("teacher 能发广播", P.can("teacher", "sendBroadcast"));
c("teacher 不能审核 UGC", !P.can("teacher", "moderate"));
c("teacher 不能进后台", !P.can("teacher", "viewAdmin"));
c("teacher 不能管用户", !P.can("teacher", "manageUsers"));
c("teacher 广播=本年级", P.broadcastScope("teacher") === "grade");
c("teacher 管本年级", P.roleManagementTier("teacher") === "grade");
// ⚠️ 设备三关铁律（#249）：teacher 收回全部设备档（连 watch 都没有）。
c("teacher 无设备档（watch 也没有）", !P.canDevice("teacher", "watch") && !P.canDevice("teacher", "control") && !P.canDevice("teacher", "remote"));

// ---- 4b. 班主任（L4，设备三关之一）----
c("homeroom 能进集控", P.can("homeroom", "viewConsole"));
c("homeroom 能发广播", P.can("homeroom", "sendBroadcast"));
c("homeroom 广播=本年级", P.broadcastScope("homeroom") === "grade");
c("homeroom 管理=本班", P.roleManagementTier("homeroom") === "class");
c("homeroom 能远控（设备轴）", P.canDevice("homeroom", "remote"));
c("homeroom 无 manage 设备档", !P.canDevice("homeroom", "manage"));
c("homeroom 标签=班主任", P.ROLE_LABELS["homeroom"] === "班主任");
c("homeroom 等级=L4", P.roleToLevel("homeroom") === 4);

// ---- 5. 审核 / 编辑（L5）----
c("moderator 能审核 UGC", P.can("moderator", "moderate"));
c("moderator 能审权限申请", P.can("moderator", "reviewPermission"));
c("moderator 能进后台", P.can("moderator", "viewAdmin"));
c("moderator 广播=本年级（未放大到全校）", P.broadcastScope("moderator") === "grade");
c("editor 能进后台", P.can("editor", "viewAdmin"));
c("editor 能管内容", P.can("editor", "manageContent"));
c("editor 广播=全校", P.broadcastScope("editor") === "school");

// ---- 6. 管理 / 站长（L6）----
c("admin 能管用户", P.can("admin", "manageUsers"));
c("admin 能管设备", P.can("admin", "manageDevices") && P.canDevice("admin", "manage"));
c("admin 广播=全校", P.broadcastScope("admin") === "school");
c("owner 能管权限矩阵", P.can("owner", "managePermissions"));

// ---- 7. 表完整性 ----
c("LEVEL_LABELS 共 6 级", Object.keys(P.LEVEL_LABELS).length === 6);
c("LEVEL_SAMPLE_ROLE 共 6 级", Object.keys(P.LEVEL_SAMPLE_ROLE).length === 6);
c("可分配角色都有中文标签", P.ASSIGNABLE_ROLES.every((r) => !!P.ROLE_LABELS[r]));
c("可分配角色都有等级", P.ASSIGNABLE_ROLES.every((r) => P.roleToLevel(r) !== null));
// （修正原先写坏的这一条：`r in { viewer: 1 } === false` 恒为 true，等于没测。）
// 真意是「每个可分配角色都有广播范围定义」——允许值为 null（viewer 不可广播），
// 但键必须存在，否则 spread/查表会静默拿到 undefined。
c("可分配角色都有广播范围定义（键存在，允许 null）",
	P.ASSIGNABLE_ROLES.every((r) => P.broadcastScope(r) === null || !!P.BROADCAST_SCOPE_LABELS[P.broadcastScope(r)]));
c("可分配角色都有设备档定义", P.ASSIGNABLE_ROLES.every((r) => Array.isArray(P.roleDeviceTiers(r))));
c("每级都有示例角色且等级自洽",
	Object.entries(P.LEVEL_SAMPLE_ROLE).every(([lv, r]) => P.roleToLevel(r) === Number(lv)));

// ---- 8. 权限矩阵覆盖全部等级（防「六等扩级漏一行 L6」复发）----
// 该 bug 真实发生过：capabilitiesByLevel() 写死 [1,2,3,4,5]，矩阵页永远少 L6 那行。
{
	const rows = P.capabilitiesByLevel();
	const maxLevel = Math.max(...P.ASSIGNABLE_ROLES.map((r) => P.roleToLevel(r) ?? 0));
	c("矩阵行数 == 最高等级", rows.length === maxLevel);
	c("矩阵逐级连续无缺口", rows.every((r, i) => r.level === i + 1));
	c("矩阵含最高等级 L6 行", rows.some((r) => r.level === maxLevel));
	const l6 = rows.find((r) => r.level === maxLevel);
	c("L6 行确实有动作（不是空壳行）", !!l6 && l6.actions.length > 0);
	c("L6 行含 manageUsers/manageSettings", !!l6
		&& l6.actions.includes("manageUsers") && l6.actions.includes("manageSettings"));
	// 反向：每个动作都必须被某一等级收纳，否则它永远不会出现在矩阵里。
	const covered = new Set(rows.flatMap((r) => r.actions));
	const all = Object.keys(P.ACTION_LABELS);
	c("所有动作都被矩阵收录", all.every((a) => covered.has(a)));
}

// ---- 9. 称号模型（2026-09-20 #181 重构：称号才是权限载体，等级只是显示秩位）----
// 核心不变量：can(role, action) 由 ROLE_TITLES 的称号并集推导，与重构前（等级阈值）逐角色逐 action 等价；
// 且 userCan() 对「无显式称号」的用户必须与 can() 完全一致（回退语义不能漂移）。
{
	// 9.1 称号目录完整性：每个称号键都有定义、label 唯一、actions 都落在 ACTION_LABELS 内。
	const keys = P.TITLE_KEYS;
	c("称号目录非空", keys.length > 0);
	c("称号键唯一", new Set(keys).size === keys.length);
	c("每个称号有中文标签", keys.every((k) => !!P.TITLES[k].label));
	c("每个称号的 actions 都是合法 Action",
		keys.every((k) => P.TITLES[k].actions.every((a) => a in P.ACTION_LABELS)));

	// 9.2 每个 Action 必须至少被一个称号授予（否则 `can()` 恒 false，该能力形同虚设）。
	const coveredByTitle = new Set();
	for (const k of keys) for (const a of P.TITLES[k].actions) coveredByTitle.add(a);
	const actionKeys = Object.keys(P.ACTION_LABELS);
	c("每个 Action 都被至少一个称号授予", actionKeys.every((a) => coveredByTitle.has(a)));

	// 9.3 覆盖写语义：userCan 优先显式称号；null/undefined/空数组 → 回退角色预设 = can(role)。
	for (const r of P.ASSIGNABLE_ROLES) {
		// 无显式称号（null/undefined/空数组）→ 与 can(role) 逐 action 一致
		for (const a of actionKeys) {
			const viaRole = P.can(r, a);
			c(`userCan({role:${r}}) == can(${r}) [${a}]`,
				P.userCan({ role: r, titles: null }, a) === viaRole
				&& P.userCan({ role: r, titles: [] }, a) === viaRole
				&& P.userCan({ role: r }, a) === viaRole);
		}
		// 显式称号 → 完全由该集合决定，与角色无关
		const explicit = ["stationmaster"];
		c(`userCan 显式称号覆盖角色 [${r}]`,
			P.userCan({ role: r, titles: explicit }, "manageUsers") === true
			&& P.userCan({ role: r, titles: explicit }, "viewAdmin") === false);
		// 空数组的语义是「回退角色预设」（auth.setUserTitles 传 [] 即清空 user_titles 行），
		// 因此任何角色传 [] 都应与其 can(role) 一致；不存在「显式零称号」态。
		const emptySemantics = P.userCan({ role: r, titles: [] }, "viewConsole");
		c(`userCan 空数组=回退角色预设 [${r}]`, emptySemantics === P.can(r, "viewConsole"));
	}

	// 9.4 设备轴与称号正交：改称号不改变 canDevice / canBroadcastTo / 管理分级（它们按角色表驱动）。
	//     ⚠️ 设备三关铁律（#249）：watch 仅授予 站长/班主任/电教委员（owner/admin/homeroom/techrep）。
	const WATCH_ROLES = new Set(["owner", "admin", "homeroom", "techrep"]);
	for (const r of P.ASSIGNABLE_ROLES) {
		c(`设备轴与称号正交 [${r}]`, P.canDevice(r, "watch") === WATCH_ROLES.has(r));
	}
	// 三关之外的任何角色连 watch 都没有（铁律 = 设备列表必须为空）。
	c("非三关角色一律无设备档",
		P.ASSIGNABLE_ROLES.filter((r) => !WATCH_ROLES.has(r))
			.every((r) => !P.canDevice(r, "watch") && !P.canDevice(r, "control") && !P.canDevice(r, "remote")));
	// 三关角色档位矩阵（防将来误加/误删）。
	c("三关角色档位矩阵",
		P.canDevice("owner", "manage") && P.canDevice("admin", "manage")
		&& P.canDevice("homeroom", "remote") && !P.canDevice("homeroom", "manage")
		&& P.canDevice("techrep", "remote") && !P.canDevice("techrep", "manage"));

	// 9.5 等级只是显示秩位：roleToLevel 仍存在且完整（UI 展示用），但不参与 can() 判定。
	//     roleCapabilitiesSummary 的 actions 应来自称号并集而非等级阈值。
	const summary = P.roleCapabilitiesSummary("techrep");
	c("techrep 能力摘要含 viewConsole（称号授予）", summary.actions.includes("viewConsole"));
	c("techrep 能力摘要不含 moderate（未被称号授予）", !summary.actions.includes("moderate"));
	c("techrep 显示秩位 L3", summary.level === 3);

	// 9.6 permissionMatrix 下发的称号字段齐全（前端「我的称号」渲染依赖）。
	const mx = P.permissionMatrix("techrep");
	c("矩阵含称号目录", Array.isArray(mx.titles) && mx.titles.length === keys.length);
	c("矩阵 me 含称号与中文标签", Array.isArray(mx.me.titles) && Array.isArray(mx.me.titleLabels));
	c("矩阵角色行含称号", mx.roles.every((r) => Array.isArray(r.titles) && Array.isArray(r.titleLabels)));

	// 9.7 permissionMatrix 传用户对象时，me 快照必须反映显式称号（覆盖写优先），
	//     与 userCan() 门控同源 —— 防止「界面显示的能力」与「服务端放行」漂移。
	{
		const overridden = P.permissionMatrix({ role: "viewer", titles: ["stationmaster"] });
		c("permissionMatrix(用户对象) 反映显式称号",
			overridden.me.titles.includes("stationmaster")
			&& overridden.me.actions.includes("manageUsers")
			&& !overridden.me.titleLabels.includes("访客"));
		// 角色预设仍然反映到 roles 表（那是各角色的默认组合，不受单用户覆盖影响）
		c("permissionMatrix roles 表仍按角色预设",
			mx.roles.every((r) => Array.isArray(r.titles) && r.titles.length > 0));
		// 纯角色参数兼容旧调用
		const legacy = P.permissionMatrix("viewer");
		c("permissionMatrix(纯角色) 兼容旧调用", legacy.me.titles.join() === "visitor");
	}
}

const fail = checks.filter(([, ok]) => !ok);
for (const [n, ok] of checks) console.log(`${ok ? "✅" : "❌"} ${n}`);
console.log(`\n=== ${checks.length - fail.length}/${checks.length} 通过 ===`);
process.exit(fail.length ? 1 : 0);
