import { json } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";

export function GET({ cookies }) {
	const user = verifyToken(cookies.get("admin_token"));
	if (!user) return json(null);
	return json({
		username: user.username,
		displayName: user.displayName,
		role: user.role,
		createdAt: user.createdAt
	});
}