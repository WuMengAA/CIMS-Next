// 统一权限矩阵：纯函数，前后端通用（无 server-only 依赖）。
// 角色从低到高：user < moderator < editor < admin。
// 所有“能否做某事”的判断都走 can(role, action)，避免散落各处写死角色名。

export type Role = "admin" | "editor" | "moderator" | "user";

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
	| "viewAdmin"; // 进入后台管理台

const MATRIX: Record<Role, Action[]> = {
	admin: [
		"comment", "postForum", "createChannel", "submitFeedback", "submitProject", "submitLink", "suggestDoc",
		"moderate", "manageContent", "manageUsers", "manageSettings", "manageFiles", "viewAdmin"
	],
	editor: [
		"comment", "postForum", "createChannel", "submitFeedback", "submitProject", "submitLink", "suggestDoc",
		"moderate", "manageContent", "manageFiles", "viewAdmin"
	],
	moderator: [
		"comment", "postForum", "createChannel", "submitFeedback", "submitLink", "suggestDoc",
		"moderate"
	],
	user: [
		"comment", "postForum", "submitFeedback", "submitLink", "suggestDoc"
	]
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
	user: "注册用户"
};
