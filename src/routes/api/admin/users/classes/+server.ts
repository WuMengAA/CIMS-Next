import { redirect } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";

/**
 * 旧路由 301 → /api/class/users。
 *
 * 2026-10-04（班级域收口）：用户↔班级绑定管理迁到 `/api/class/users`，
 * 旧 `/api/admin/users/classes` 保留 301 重定向（双保险）。
 */
export function GET(event: RequestEvent) {
	redirect(301, "/api/class/users" + (event.url.search || ""));
}
export function PUT(event: RequestEvent) {
	redirect(301, "/api/class/users");
}
export function DELETE(event: RequestEvent) {
	redirect(301, "/api/class/users" + (event.url.search || ""));
}
