import { json } from "@sveltejs/kit";
import { getNav, saveNav } from "$lib/server/content-store.js";
import { verifyToken } from "$lib/server/auth.js";
import { userCan } from "$lib/permissions.js";

/** 导航是公开数据（每个页面都要渲染），读取不设门槛。 */
export function GET() {
	return json(getNav());
}

/**
 * 保存导航。门槛与后台「导航管理」入口一致（manageContent）——
 * 之前这里只校验「登录」，等于任何登录用户都能改名全站侧边栏；
 * 入口藏起来不算边界，API 才要自己判一次。
 */
export async function POST({ request }) {
	const user = verifyToken(request.headers.get("cookie")?.match(/admin_token=([^;]+)/)?.[1] || "");
	if (!user) return json({ error: "未登录" }, { status: 401 });
	if (!userCan(user, "manageContent")) return json({ error: "权限不足" }, { status: 403 });

	const body = await request.json();
	saveNav({
		workspace: Array.isArray(body.workspace) ? body.workspace : [],
		more: Array.isArray(body.more) ? body.more : [],
		bottom: Array.isArray(body.bottom) ? body.bottom : [],
		// 自定义组（镜像站等）由 saveNav 统一清洗：key 去重、布局/范围走白名单。
		groups: Array.isArray(body.groups) ? body.groups : []
	});
	return json({ ok: true });
}
