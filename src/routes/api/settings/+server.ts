import { json } from "@sveltejs/kit";
import { getSettings, saveSettings } from "$lib/server/content-store.js";
import { getApiUser } from "$lib/server/api-auth.js";
import { can } from "$lib/permissions.js";

export function GET() {
	return json(getSettings());
}

export async function POST({ request }) {
	const user = await getApiUser(request);
	if (!user) return json({ error: "未登录" }, { status: 401 });
	// T11（2026-10-03）：原先只判「已登录」—— 任何 viewer 都能改全站名/标语/页脚/社交链接，
	// 等于把整站文案写权限发给最低档角色。写动作必须是站长级能力。
	// GET 保持公开：站点文案是公开可取的展示数据，收紧它只会让首屏 SSR 拿不到数据。
	if (!can(user.role, "manageSettings")) return json({ error: "仅站长可修改站点设置" }, { status: 403 });
	const body = await request.json();
	const current = getSettings();
	// Merge so new fields (siteName/slogan/heroTitle/features/…) aren't lost
	saveSettings({
		...current,
		title: body.title || current.title,
		description: body.description ?? current.description,
		siteName: body.siteName ?? current.siteName,
		slogan: body.slogan ?? current.slogan,
		heroTitle: body.heroTitle ?? current.heroTitle,
		heroSubtitle: body.heroSubtitle ?? current.heroSubtitle,
		heroBadge: body.heroBadge ?? current.heroBadge,
		features: Array.isArray(body.features) ? body.features : current.features,
		socialTitle: body.socialTitle ?? current.socialTitle,
		footer: body.footer ?? current.footer,
		socials: Array.isArray(body.socials) ? body.socials.filter((x: any) => x && x.name && x.url) : current.socials
	});
	return json({ ok: true });
}