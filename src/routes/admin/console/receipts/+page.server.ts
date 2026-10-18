import { redirect } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { userCan, canDevice } from "$lib/permissions.js";
import type { PageServerLoad } from "./$types";

// 执行回执（Svelte 版）：viewConsole 门槛；设备执行流水额外要求 control 档。
export const load: PageServerLoad = async ({ cookies }: { cookies: import("@sveltejs/kit").Cookies }) => {
	const u = await verifyToken(cookies.get("admin_token") ?? "");
	if (!u || !userCan(u, "viewConsole")) throw redirect(303, "/admin/login");
	return { role: u.role, can: { control: canDevice(u.role, "control") } };
};
