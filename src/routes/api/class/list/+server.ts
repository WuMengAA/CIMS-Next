import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { userCan } from "$lib/permissions.js";
import { listStelarithClasses, stelarithClassesReady } from "$lib/server/stelarith/classes.js";

/**
 * GET /api/class/list —— 班级列表（自有真源优先，CIMS 兜底）。
 *
 * 2026-10-04（班级域收口）：从 `/api/classes` 迁来，旧路由 301 重定向。
 * 数据源改为站点自有 `stelarith_classes` 表（迁移自 CIMS /class/list，13 班）。
 *   · 本地有数据 → 直接返回（source=local），**不再问 CIMS**；
 *   · 本地为空（迁移期/新环境）→ 回退 CIMS；两者都拿不到 → 502 明示，**绝不掺演示数据**。
 *
 * 历史契约保留：登录即可读（viewConsole 及以上）；绑定页、传文件选班、通知选班都用它。
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

	// 本地优先：自有表有数据就服务，CIMS 不可达也不受影响
	if (stelarithClassesReady()) {
		return json({ classes: listStelarithClasses(), source: "local" });
	}

	// 本地为空 → CIMS 兜底（迁移脚本未跑 / 新环境首次启动）
	try {
		const { fetchClassList } = await import("$lib/server/cims-client.js");
		const classes = await fetchClassList();
		if (classes) return json({ classes, source: "cims" });
	} catch {
		/* fallthrough */
	}
	return json(
		{
			error: "班级列表暂不可用（本地未导入且 CIMS 不可达）：只显示真实班级，不使用演示数据。请检查 CIMS 服务或运行班级迁移脚本。",
			classes: [],
			source: "none"
		},
		{ status: 502 }
	);
}
