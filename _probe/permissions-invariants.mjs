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
c("teacher 可控制设备", P.canDevice("teacher", "control"));
c("teacher 不可远控", !P.canDevice("teacher", "remote"));

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

const fail = checks.filter(([, ok]) => !ok);
for (const [n, ok] of checks) console.log(`${ok ? "✅" : "❌"} ${n}`);
console.log(`\n=== ${checks.length - fail.length}/${checks.length} 通过 ===`);
process.exit(fail.length ? 1 : 0);
