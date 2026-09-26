import { json } from "@sveltejs/kit";
import {
	SITE_VERSION,
	SITE_BUILD,
	SITE_UPDATED_AT,
	SITE_SERVICE,
	XK_LATEST_VERSION,
	XK_LATEST_BUILD,
	XK_RELEASE_URL,
	XK_RELEASE_SHA256,
	XK_RELEASE_NOTES,
	XK_MIN_SUPPORTED,
	XK_UPDATED_AT
} from "$lib/server/site-version.js";

/**
 * #245 同步+自动更新 —— 网站版本接口（桌面端 OTA 源）。
 *
 * 桌面端（admin-console-native / xingjikong）与安卓端定期/启动时请求本接口，
 * 与本地版本比较；有更新时按返回的 url 拉取安装包，并用 sha256 校验后自替换。
 * 返回体字段与 Flutter 端 update_check.dart 的 AppVersion 解析契约对齐：
 *   { latestVersion, build(整数), url, sha256, notes, minSupported, updatedAt, service }
 *
 * 无需鉴权：版本与安装包地址本就是公开可查的（类似 /api/health）。
 */
export async function GET() {
	return json({
		// 兼容旧客户端（读 version 字段）
		version: XK_LATEST_VERSION,
		latestVersion: XK_LATEST_VERSION,
		build: XK_LATEST_BUILD,
		url: XK_RELEASE_URL,
		sha256: XK_RELEASE_SHA256,
		notes: XK_RELEASE_NOTES,
		minSupported: XK_MIN_SUPPORTED,
		updatedAt: XK_UPDATED_AT,
		service: "xingjikong"
	});
}
