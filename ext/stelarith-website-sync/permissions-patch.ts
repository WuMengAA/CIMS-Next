// permissions-patch.ts
// 在 stelarith-website 的 src/lib/permissions.ts 中扩展集控角色与权限。
// 直接并入现有 Role / Action / MATRIX 即可，与既有 can(role, action) 矩阵统一。
//
// 用法：把下方片段合入 permissions.ts（注意保留原 admin/editor/moderator/user 不变）。

// 1) 扩展 Role 类型
export type Role = "admin" | "editor" | "moderator" | "user" | "techrep" | "viewer";

// 2) 扩展 Action（集控相关）
export type Action =
  | "comment"
  | "postForum"
  | "createChannel"
  | "submitFeedback"
  | "submitProject"
  | "submitLink"
  | "suggestDoc"
  | "moderate"
  | "manageContent"
  | "manageUsers"
  | "manageSettings"
  | "manageFiles"
  | "viewAdmin"
  // ---- 集控新增 ----
  | "viewConsole"        // 进入集控面板
  | "controlDevice"      // 本班/本年级设备控制（锁屏/重启/截图）
  | "remoteControl"      // 远程屏幕控制（更高敏感）
  | "submitIssue"        // 提交故障工单 / Bug
  | "manageDevices";     // 全量设备管理（管理员）

// 3) 在 MATRIX 中追加 techrep / viewer（其余角色保持原样）
const MATRIX: Record<Role, Action[]> = {
  admin: [ /* ...原有... */ "viewConsole", "controlDevice", "remoteControl", "submitIssue", "manageDevices" ],
  editor: [ /* ...原有... */ "viewConsole", "controlDevice", "submitIssue" ],
  moderator: [ /* ...原有... */ "viewConsole", "submitIssue" ],
  user: [ /* ...原有... */ "submitIssue" ],
  techrep: [                                   // 电教委员：本班设备 + 上报，无用户管理
    "comment", "postForum", "submitFeedback", "submitLink", "suggestDoc",
    "viewConsole", "controlDevice", "remoteControl", "submitIssue"
  ],
  viewer: [ "viewConsole" ],                   // 只读：仅看面板，无写操作
};

// 4) 标签（可选）
export const ROLE_LABELS: Record<Role, string> = {
  admin: "管理员",
  editor: "编辑",
  moderator: "审核员",
  user: "注册用户",
  techrep: "电教委员",
  viewer: "只读",
};

// 此后面板菜单按 can(role, "remoteControl") / can(role, "controlDevice") 渲染可见性。
