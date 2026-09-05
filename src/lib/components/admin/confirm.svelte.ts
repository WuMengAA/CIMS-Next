// 通用删除/危险操作确认对话框：模块级单例状态 + Promise API。
// 用法：if (!(await confirmDelete("删除文章", "此操作不可恢复"))) return;
export interface ConfirmState {
	open: boolean;
	title: string;
	description: string;
	resolve: ((v: boolean) => void) | null;
}

export const confirmState = $state<ConfirmState>({
	open: false,
	title: "",
	description: "",
	resolve: null
});

export function confirmDelete(title: string, description = "此操作不可恢复。"): Promise<boolean> {
	return new Promise((resolve) => {
		// 若已有未决对话框，先以取消结案
		confirmState.resolve?.(false);
		confirmState.title = title;
		confirmState.description = description;
		confirmState.resolve = resolve;
		confirmState.open = true;
	});
}

export function settleConfirm(v: boolean) {
	confirmState.resolve?.(v);
	confirmState.resolve = null;
	confirmState.open = false;
}
