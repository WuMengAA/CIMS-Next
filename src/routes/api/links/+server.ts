import { json } from "@sveltejs/kit";
import { getLinks, saveLinks } from "$lib/server/content-store.js";
import { getApiUser } from "$lib/server/api-auth.js";

export function GET() {
	return json(getLinks());
}

export async function POST({ request }) {
	const user = getApiUser(request);
	if (!user) return json({ error: "未登录" }, { status: 401 });
	const action = request.headers.get("x-action");
	const body = await request.json();
	if (action === "save") {
		saveLinks(body.links || []);
		return json({ ok: true });
	}
	return json({ error: "unknown action" }, { status: 400 });
}