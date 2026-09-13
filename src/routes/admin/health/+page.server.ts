import type { PageServerLoad } from "./$types";
import { probeServices } from "$lib/server/health.js";

// 权限由 hooks.server.ts 统一守卫：/admin/* 非登录/api-auth 一律需 viewAdmin，本页自动满足。
export const load: PageServerLoad = async () => {
	const services = await probeServices();
	return { services, checkedAt: new Date().toISOString() };
};
