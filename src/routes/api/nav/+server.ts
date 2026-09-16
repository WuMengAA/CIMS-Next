import { json } from "@sveltejs/kit";
import { getNav, saveNav } from "$lib/server/content-store.js";
import { verifyToken } from "$lib/server/auth.js";

export function GET() {
	return json(getNav());
}

export async function POST({ request }) {
	const user = verifyToken(request.headers.get("cookie")?.match(/admin_token=([^;]+)/)?.[1] || "");
	if (!user) return json({ error: "未登录" }, { status: 401 });
	const body = await request.json();
	saveNav({
		workspace: Array.isArray(body.workspace) ? body.workspace : [],
		more: Array.isArray(body.more) ? body.more : [],
		bottom: Array.isArray(body.bottom) ? body.bottom : []
	});
	return json({ ok: true });
}