import { json } from "@sveltejs/kit";
import { verifyLogin, makeToken, createUser, deleteUser, changePassword, getUsers, verifyToken } from "$lib/server/auth.js";

export async function POST({ request, cookies }) {
	const body = await request.json();
	const action = body.action || "login";

	if (action === "login") {
		const { username, password } = body;
		if (!username || !password) {
			return json({ error: "请输入用户名和密码" }, { status: 400 });
		}
		const user = verifyLogin(username, password);
		if (!user) {
			return json({ error: "用户名或密码错误" }, { status: 401 });
		}
		cookies.set("admin_token", makeToken(user), {
			path: "/",
			httpOnly: true,
			sameSite: "strict",
			secure: false
		});
		return json({ ok: true, user: { username: user.username, displayName: user.displayName, role: user.role } });
	}

	if (action === "logout") {
		cookies.delete("admin_token", { path: "/" });
		return json({ ok: true });
	}

	if (action === "create_user") {
		const current = verifyToken(cookies.get("admin_token"));
		if (!current || current.role !== "admin") {
			return json({ error: "无权限" }, { status: 403 });
		}
		const result = createUser(body.username, body.password, body.displayName, body.role);
		return result.ok ? json({ ok: true }) : json({ error: result.error }, { status: 400 });
	}

	if (action === "delete_user") {
		const current = verifyToken(cookies.get("admin_token"));
		if (!current || current.role !== "admin") {
			return json({ error: "无权限" }, { status: 403 });
		}
		const result = deleteUser(body.username);
		return result.ok ? json({ ok: true }) : json({ error: result.error }, { status: 400 });
	}

	if (action === "change_password") {
		const current = verifyToken(cookies.get("admin_token"));
		if (!current) {
			return json({ error: "未登录" }, { status: 401 });
		}
		const target = body.username || current.username;
		if (target !== current.username && current.role !== "admin") {
			return json({ error: "无权限" }, { status: 403 });
		}
		const result = changePassword(target, body.newPassword);
		return result.ok ? json({ ok: true }) : json({ error: result.error }, { status: 400 });
	}

	return json({ error: "unknown action" }, { status: 400 });
}

export async function GET({ cookies }) {
	const user = verifyToken(cookies.get("admin_token"));
	if (!user) return json({ error: "未登录" }, { status: 401 });
	if (user.role !== "admin") {
		return json({ users: [] });
	}
	const users = getUsers().map(u => ({ username: u.username, displayName: u.displayName, role: u.role, createdAt: u.createdAt }));
	return json({ users, current: user.username });
}