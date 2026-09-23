import { json } from "@sveltejs/kit";
import { SITE_VERSION, SITE_BUILD, SITE_UPDATED_AT, SITE_SERVICE } from "$lib/server/site-version.js";

/**
 * #245 同步+自动更新 —— 网站版本接口。
 *
 * 桌面端（admin-console-native / xingjikong）与安卓端定期/启动时请求本接口，
 * 与本地版本比较后弹更新提示。返回体字段与 Flutter 端 update_check.dart 的
 * fetchLatestVersion 解析契约对齐：{ version, build, updatedAt }。
 *
 * 无需鉴权：版本信息本就是公开可查的（类似 /api/health）。
 */
export async function GET() {
	return json({
		version: SITE_VERSION,
		build: SITE_BUILD,
		updatedAt: SITE_UPDATED_AT,
		service: SITE_SERVICE
	});
}
