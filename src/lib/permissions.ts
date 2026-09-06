// 统一权限矩阵：纯函数，前后端通用（无 server-only 依赖）。
// 角色从低到高：user < moderator < editor < admin。
// 所有“能否做某事”的判断都走 can(role, action)，避免散落各处写死角色名。

export type Role = "admin" | "editor" | "moderator" | "user" | "techrep" | "viewer";

export type Action =
	| "comment" // 发表评论
	| "postForum" // 论坛发帖
	| "createChannel" // 建立论坛频道
	| "submitFeedback" // 提交反馈/issue
	| "submitProject" // 申请软件专页
	| "submitLink" // 申请友链
	| "suggestDoc" // 纠正/建议文档
	| "moderate" // 审核 UGC（评论/反馈/论坛/申请）
	| "manageContent" // 管理博客/项目/文档（CRUD）
	| "manageUsers" // 用户与角色管理
	| "manageSettings" // 站点设置
	| "manageFiles" // 文件/媒体管理
	| "viewAdmin" // 进入后台管理台
	// ---- 集控新增 ----
	| "viewConsole" // 进入集控面板（/admin/console）
	| "controlDevice" // 本班/本年级设备控制（锁屏/重启/截图）
	| "remoteControl" // 远程屏幕控制（更高敏感）
	| "submitIssue" // 提交故障工单 / Bug
	| "manageDevices"; // 全量设备管理（管理员）

const MATRIX: Record<Role, Action[]> = {
	admin: [
		"comment", "postForum", "createChannel", "submitFeedback", "submitProject", "submitLink", "suggestDoc",
		"moderate", "manageContent", "manageUsers", "manageSettings", "manageFiles", "viewAdmin",
		"viewConsole", "controlDevice", "remoteControl", "submitIssue", "manageDevices"
	],
	editor: [
		"comment", "postForum", "createChannel", "submitFeedback", "submitProject", "submitLink", "suggestDoc",
		"moderate", "manageContent", "manageFiles", "viewAdmin",
		"viewConsole", "controlDevice", "submitIssue"
	],
	moderator: [
		"comment", "postForum", "createChannel", "submitFeedback", "submitLink", "suggestDoc",
		"moderate", "viewConsole", "submitIssue"
	],
	user: [
		"comment", "postForum", "submitFeedback", "submitLink", "suggestDoc", "submitIssue"
	],
	// 电教委员：本班设备控制 + 远程控制 + 上报，无用户/站点管理
	techrep: [
		"comment", "postForum", "submitFeedback", "submitLink", "suggestDoc",
		"viewConsole", "controlDevice", "remoteControl", "submitIssue"
	],
	// 只读：仅查看集控面板，无任何写操作
	viewer: [ "viewConsole" ]
};

/** 判断某角色是否拥有某项权限。未登录（role 为空）一律 false。 */
export function can(role: Role | null | undefined, action: Action): boolean {
	if (!role) return false;
	return (MATRIX[role] ?? []).includes(action);
}

export const ROLE_LABELS: Record<Role, string> = {
	admin: "管理员",
	editor: "编辑",
	moderator: "审核员",
	user: "注册用户",
	techrep: "电教委员",
	viewer: "只读"
};
