import { json } from "@sveltejs/kit";
import { getSettings, saveSettings } from "$lib/server/content-store.js";
import { getApiUser } from "$lib/server/api-auth.js";

export function GET() {
	return json(getSettings());
}

export async function POST({ request }) {
	const user = getApiUser(request);
	if (!user) return json({ error: "未登录" }, { status: 401 });
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