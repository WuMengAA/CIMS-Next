import { redirect } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";

/**
 * GET /api/classes —— 旧路由 301 → /api/class/list。
 *
 * 2026-10-04（班级域收口）：班级列表迁到 `/api/class/list`，
 * 旧 `/api/classes` 保留 301 重定向（漏改的前端调用仍能拿到数据，双保险）。
 */
export function GET(event: RequestEvent) {
	redirect(301, "/api/class/list");
}
