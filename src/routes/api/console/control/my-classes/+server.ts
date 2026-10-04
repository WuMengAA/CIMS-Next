import { redirect } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";

/**
 * 旧路由 301 → /api/class/my。
 *
 * 2026-10-04（班级域收口）：我的班级绑定迁到 `/api/class/my`，
 * 旧 `/api/console/control/my-classes` 保留 301 重定向（双保险）。
 */
export function GET(event: RequestEvent) {
	redirect(301, "/api/class/my");
}
