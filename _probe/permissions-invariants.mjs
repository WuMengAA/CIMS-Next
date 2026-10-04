// 权限矩阵不变量回归。
// 运行：node --experimental-strip-types _probe/permissions-invariants.mjs
//
// ⚠️ 2026-10-01 修复：本脚本原先调用 `roleToLevel()` / `LEVEL_SAMPLE_ROLE` / `capabilitiesByLevel()`，
//    而 #181（2026-09-20 称号模型重构）后这三个 API **已被删除**（现仅存于 permissions.ts 的注释里），
//    脚本一跑就在第 9 行 `roleToLevel is not a function` 崩掉 —— 等于**守护用例长期失效**（跑不起来）。
//    现改用当前 API：角色秩位 = `roleRank()`（数值与旧 roleToLevel 一致），
//    等级轴矩阵 → 改为对 `permissionMatrix()` 的角色/三轴覆盖做断言。
import * as P from "../src/lib/permissions.ts";

const checks = [];
const c = (name, ok) => checks.push([name, !!ok]);

// ---- 1. 角色秩位谱系（旧 roleToLevel 的正名：只做显示与排序，不参与 can() 判定）----
c("viewer 秩 1", P.roleRank("viewer") === 1);
c("user 秩 2", P.roleRank("user") === 2);
c("techrep 秩 3", P.roleRank("techrep") === 3);
c("teacher 秩 4", P.roleRank("teacher") === 4);
c("moderator 秩 5", P.roleRank("moderator") === 5);
c("editor 秩 5", P.roleRank("editor") === 5);
c("admin 秩 6", P.roleRank("admin") === 6);
c("owner 秩 6", P.roleRank("owner") === 6);
c("未登录秩 0", P.roleRank(null) === 0 && P.roleRank(undefined) === 0);

// ---- 2. 防「等级平移导致的被动放大」：techrep 2→3 后不得拿到原 L3 能力 ----
c("techrep 不能 moderate", !P.can("techrep", "moderate"));
c("techrep 不能 createChannel", !P.can("techrep", "createChannel"));
c("techrep 不能 sendBroadcast", !P.can("techrep", "sendBroadcast"));
c("techrep 不能 reviewPermission", !P.can("techrep", "reviewPermission"));
c("techrep 不能进后台", !P.can("techrep", "viewAdmin"));
c("techrep 能进集控（设计意图）", P.can("techrep", "viewConsole"));
// ⚠️ 2026-10-01 更正：`ROLE_DEVICE.techrep` 自 v2（提交 23186ce）起被清空 ——
//    电教委员的设备能力整体迁到**动作轴** `ROLE_DEVICE_ACTIONS`
//    （file / apps_view / logs_view），粗档（watch/control/remote/manage）一条不给，
//    这样任何未列入白名单的**裸代理指令**都发不出去（fail-closed）。
//    设备**列表**的读权限另由 cims 代理放宽 apps_view/logs_view 提供，
//    见 src/routes/api/console/cims/[...cims]/+server.ts:46-66（2026-09-27「只放宽读」）。
//    原断言 `canDevice("techrep","remote") === true` 测的是已废弃的粗档 → 更正之。
c("techrep 无控制/远控粗档（v2 收回，改走动作轴）",
	!P.canDevice("techrep", "watch") && !P.canDevice("techrep", "control") && !P.canDevice("techrep", "remote"));
c("techrep 仍能读设备列表（动作轴 apps_view/logs_view）",
	P.canDeviceAction("techrep", "apps_view") && P.canDeviceAction("techrep", "logs_view"));
c("techrep 无 manage 设备档", !P.canDevice("techrep", "manage"));

// ---- 3. 学生（L2）收紧：集控门槛 L2→L3 ----
c("user 不能进集控", !P.can("user", "viewConsole"));
c("user 能评论", P.can("user", "comment"));
c("user 广播仅本班", P.broadcastScope("user") === "class");
c("viewer 不能评论", !P.can("viewer", "comment"));
c("viewer 不能进集控", !P.can("viewer", "viewConsole"));
c("viewer 不能广播", P.broadcastScope("viewer") === null);

// ---- 4. 老师（L4，新角色）----
// 2026-10-01 修回：teacher 的**内容轴**广播（本班）曾被 v2 静默掐断 ——
// ROLE_SCOPE.teacher 写成 null 后，ROLE_NOTICE_TYPES.teacher = [notice,island]、
// ext 路由注释「老师仍须能发本班通知」、CIMS-判据详解「普通教师只给本班发消息/广播」
// 三处全部不可达。现 classTeacher 称号补 sendBroadcast，范围收敛到本班。
c("teacher 能发广播（本班）", P.can("teacher", "sendBroadcast"));
c("teacher 不能审核 UGC", !P.can("teacher", "moderate"));
c("teacher 不能进后台", !P.can("teacher", "viewAdmin"));
c("teacher 不能管用户", !P.can("teacher", "manageUsers"));
c("teacher 广播=本班（非年级）", P.broadcastScope("teacher") === "class");
c("teacher 广播类型仅 notice/island（无 popup/fullscreen）",
	P.noticeTypesOf("teacher").join(",") === "notice,island");
c("teacher 管本年级", P.roleManagementTier("teacher") === "grade");
// ⚠️ 设备三关铁律（#249）：teacher 收回全部设备档（连 watch 都没有）。
c("teacher 无设备档（watch 也没有）", !P.canDevice("teacher", "watch") && !P.canDevice("teacher", "control") && !P.canDevice("teacher", "remote"));

// ---- 4b. 班主任（L4，设备三关之一）----
c("homeroom 能进集控", P.can("homeroom", "viewConsole"));
c("homeroom 能发广播", P.can("homeroom", "sendBroadcast"));
c("homeroom 广播=本班", P.broadcastScope("homeroom") === "class");
// ⚠️ 为什么不是「本年级」：判据写的是「本班·年级广播」，但当前 CIMS 班级数据
// **没有年级轴**（/class/list 的 graduation_year / class_number 实测全为 null，
// 12 个班就叫 1班…12班），算不出「同年级」集合。而 grade 档会让 ext /notices
// 跳过绑班校验（该分支只对 "class" 生效）→ 班主任可指定任意 class_id = 越权。
// 故在 CIMS 班级带上年级信息前，恒为 class。详见 permissions.ts ROLE_SCOPE.homeroom 注释。
c("homeroom 广播类型含 popup（不含 fullscreen）",
	P.noticeTypesOf("homeroom").join(",") === "notice,island,popup");
c("homeroom 管理=本班", P.roleManagementTier("homeroom") === "class");
c("homeroom 能远控（设备轴）", P.canDevice("homeroom", "remote"));
c("homeroom 无 manage 设备档", !P.canDevice("homeroom", "manage"));
c("homeroom 标签=班主任", P.ROLE_LABELS["homeroom"] === "班主任");
c("homeroom 秩=4", P.roleRank("homeroom") === 4);
// 绑班上限（#250/#251）：teacher≤2 / homeroom≤1 / techrep≤1，owner/admin 免绑。
c("绑班上限 teacher=2", P.classBindLimit("teacher") === 2);
c("绑班上限 homeroom=1", P.classBindLimit("homeroom") === 1);
c("绑班上限 techrep=1", P.classBindLimit("techrep") === 1);
c("teacher/homeroom/techrep 必须绑班", ["teacher", "homeroom", "techrep"].every((r) => P.requiresClassBinding(r)));
c("站长/管理员免绑班", !P.requiresClassBinding("owner") && !P.requiresClassBinding("admin"));

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
c("LEVEL_DESCRIPTIONS 共 6 级", Object.keys(P.LEVEL_DESCRIPTIONS).length === 6);
c("可分配角色都有中文标签", P.ASSIGNABLE_ROLES.every((r) => !!P.ROLE_LABELS[r]));
c("可分配角色都有秩位（且 > 0）", P.ASSIGNABLE_ROLES.every((r) => P.roleRank(r) > 0));
// （修正原先写坏的这一条：`r in { viewer: 1 } === false` 恒为 true，等于没测。）
// 真意是「每个可分配角色都有广播范围定义」——允许值为 null（viewer 不可广播），
// 但键必须存在，否则 spread/查表会静默拿到 undefined。
c("可分配角色都有广播范围定义（键存在，允许 null）",
	P.ASSIGNABLE_ROLES.every((r) => P.broadcastScope(r) === null || !!P.BROADCAST_SCOPE_LABELS[P.broadcastScope(r)]));
c("可分配角色都有设备档定义", P.ASSIGNABLE_ROLES.every((r) => Array.isArray(P.roleDeviceTiers(r))));
// 秩位谱系必须连续覆盖 1..6（防新增角色时漏给 ROLE_RANK → roleRank 落 0，排序静默错位）。
c("秩位谱系连续覆盖 1..6",
	(() => { const got = new Set(P.ASSIGNABLE_ROLES.map((r) => P.roleRank(r)));
		return [1, 2, 3, 4, 5, 6].every((n) => got.has(n)); })());

// ---- 8. 权限矩阵覆盖（旧 capabilitiesByLevel 等级轴已随 #181 取消，改为对 permissionMatrix 的角色/三轴做覆盖断言）----
// 原意图 =「扩级时矩阵漏一行」不再复现；现模型里同义的失效模式是
// 「新增角色/称号/设备档后，矩阵的某条轴少了它」——那会让面板对照表与真实门控漂移。
{
	const mx = P.permissionMatrix("techrep");
	const roles = mx.roles;
	c("矩阵角色行覆盖全部可分配角色", roles.length === new Set(P.ASSIGNABLE_ROLES.map((r) => P.ROLE_LABELS[r])).size);
	c("矩阵每行都有动作/称号/设备档字段",
		roles.every((r) => Array.isArray(r.titles) && Array.isArray(r.titleLabels) && Array.isArray(r.deviceTiers)));
	c("矩阵含站长行且有动作（不是空壳行）",
		(() => { const s = P.permissionMatrix("owner").me; return s.actions.length > 0
			&& s.actions.includes("manageUsers") && s.actions.includes("manageSettings"); })());
	// 三轴的角色列不得为空（否则面板那条轴渲染成空白）。
	c("设备轴每档都有角色", mx.deviceTiers.every((t) => t.roles.length > 0));
	c("分级轴每档都有角色", mx.managementTiers.every((t) => t.roles.length > 0));
	c("广播轴每档都有角色", mx.broadcastScopes.every((s) => s.roles.length > 0));
	// 反向：每个动作都必须被某个称号收纳，否则它永远不会出现在矩阵里。
	const covered = new Set();
	for (const k of P.TITLE_KEYS) for (const a of P.TITLES[k].actions) covered.add(a);
	c("所有动作都被矩阵收录", Object.keys(P.ACTION_LABELS).every((a) => covered.has(a)));
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

	// 9.4 设备轴与称号正交：改称号不改变 canDevice / 管理分级（它们按角色表驱动）。
	//     ⚠️ 2026-10-01 更正：**粗档 watch 只授予 站长/管理员/班主任**。
	//     电教委员（techrep）与任课教师（teacher）的「读设备列表」已迁到
	//     **动作轴** apps_view / logs_view（见第 2 节与 cims 代理的放宽注释），
	//     因此不再出现在粗档集合里 —— 旧断言把 techrep 写进 WATCH_ROLES，
	//     并把 techrep 排除在下面那条「非三关一律无档」的检查之外，
	//     等于**漏测**了 techrep。
	const WATCH_ROLES = new Set(["owner", "admin", "homeroom"]);
	for (const r of P.ASSIGNABLE_ROLES) {
		c(`粗档 watch 与角色表一致 [${r}]`, P.canDevice(r, "watch") === WATCH_ROLES.has(r));
	}
	// 粗档以外的任何角色连控制/远控都没有（铁律 = 写操作必须 fail-closed）。
	c("非粗档角色一律无控制/远控",
		P.ASSIGNABLE_ROLES.filter((r) => !WATCH_ROLES.has(r))
			.every((r) => !P.canDevice(r, "control") && !P.canDevice(r, "remote")));
	// 设备粗档矩阵（防将来误加/误删）。
	c("设备粗档矩阵",
		P.canDevice("owner", "manage") && P.canDevice("admin", "manage")
		&& P.canDevice("homeroom", "remote") && !P.canDevice("homeroom", "manage")
		&& !P.canDevice("techrep", "watch") && !P.canDevice("techrep", "remote"));

	// 9.5 等级只是显示秩位：roleRank 仍存在且完整（UI 展示用），但不参与 can() 判定。
	//     roleCapabilitiesSummary 的 actions 应来自称号并集而非等级阈值。
	//     ⚠️ 原断言用 `summary.level`，而重构后 roleCapabilitiesSummary 已不含 level 字段（改看 roleRank）。
	const summary = P.roleCapabilitiesSummary("techrep");
	c("techrep 能力摘要含 viewConsole（称号授予）", summary.actions.includes("viewConsole"));
	c("techrep 能力摘要不含 moderate（未被称号授予）", !summary.actions.includes("moderate"));
	c("techrep 显示秩位 3", P.roleRank("techrep") === 3);

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
