import { verifyToken } from "$lib/server/auth.js";
import type { Role } from "$lib/permissions.js";

export function getApiUser(request: Request): { username: string; role: Role } | null {
	const cookie = request.headers.get("cookie");
	const token = cookie?.match(/admin_token=([^;]+)/)?.[1] || "";
	const user = verifyToken(token);
	if (!user) return null;
	return { username: user.username, role: user.role };
}

export function canManage(user: { username: string; role: string } | null, owner?: string): boolean {
	if (!user) return false;
	if (user.role === "admin") return true;
	return !owner || owner === user.username;
}