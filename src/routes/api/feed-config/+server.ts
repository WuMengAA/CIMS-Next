import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getFeedConfig, saveFeedConfig } from "$lib/server/content-store.js";
import { getApiUser } from "$lib/server/api-auth.js";
import { can } from "$lib/permissions.js";

// GET  → 读取订阅源配置（需 manageSettings）
// POST → 保存订阅源配置（增删改源 + 播报设置），合并默认值，避免字段丢失
export const GET: RequestHandler = ({ request }) => {
	const user = getApiUser(request);
	if (!user || !can(user.role, "manageSettings")) return json({ error: "无权限" }, { status: 403 });
	return json(getFeedConfig());
};

export const POST: RequestHandler = async ({ request }) => {
	const user = getApiUser(request);
	if (!user || !can(user.role, "manageSettings")) return json({ error: "无权限" }, { status: 403 });
	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ error: "请求体无效" }, { status: 400 });
	}
	const saved = saveFeedConfig({
		sources: Array.isArray(body?.sources) ? body.sources : undefined,
		settings: body?.settings || undefined
	});
	return json({ ok: true, config: saved });
};
