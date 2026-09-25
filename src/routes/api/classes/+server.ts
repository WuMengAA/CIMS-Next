import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { userCan } from "$lib/permissions.js";
import { fetchClassList } from "$lib/server/cims-client.js";

/**
 * GET /api/classes —— CIMS 真实班级列表（班级系统 v2）。
 *
 * 「班级选择列表没有确切真实获取班级」修在这里：旧面板取不到数据时
 * 静默回退到内置演示班（"高一(1)班"），老师看到的是假班级、选了也推不到设备。
 * 本端点的规矩：
 *   · 数据只有一条来源 —— CIMS /class/list（45s 缓存），**绝不掺演示数据**；
 *   · 取不到 = 502 + 人话错误，调用方明示「CIMS 不可达/未导入班级」，
 *     不允许再有任何形式的假列表兜底；
 *   · 登录即可读（viewConsole 及以上）：绑定页、传文件选班、通知选班都用它。
 */
export async function GET(event: RequestEvent) {
	const cookieToken = event.cookies.get("admin_token");
	let u = cookieToken ? verifyToken(cookieToken) : null;
	if (!u) {
		const auth = event.request.headers.get("authorization") ?? "";
		if (auth.toLowerCase().startsWith("bearer ")) u = verifyToken(auth.slice(7).trim());
	}
	if (!u) return json({ error: "请先登录" }, { status: 401 });
	if (!userCan(u, "viewConsole")) return json({ error: "无权限" }, { status: 403 });

	const classes = await fetchClassList();
	if (!classes) {
		return json(
			{
				error:
					"CIMS 不可达或尚未导入班级：班级列表只显示真实班级，不会使用演示数据。请检查 CIMS 服务或在 CIMS 中导入/创建班级。",
				classes: [],
				source: "cims"
			},
			{ status: 502 }
		);
	}
	return json({ classes, source: "cims" });
}
