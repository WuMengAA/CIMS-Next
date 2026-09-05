import { json } from "@sveltejs/kit";
import { verifyToken, changePassword, verifyLogin } from "$lib/server/auth.js";

export async function POST({ request, cookies }) {
	const user = verifyToken(cookies.get("admin_token"));
	if (!user) return json({ error: "未登录" }, { status: 401 });
	const body = await request.json();
	const { currentPassword, newPassword } = body;
	if (!verifyLogin(user.username, currentPassword || "")) {
		return json({ error: "当前密码不正确" }, { status: 400 });
	}
	const result = changePassword(user.username, newPassword);
	return result.ok ? json({ ok: true }) : json({ error: result.error }, { status: 400 });
}