import { json } from "@sveltejs/kit";
import {
	XK_LATEST_VERSION,
	XK_LATEST_BUILD,
	XK_RELEASE_URL,
	XK_RELEASE_SHA256,
	XK_RELEASE_NOTES,
	XK_MIN_SUPPORTED,
	XK_UPDATED_AT
} from "$lib/server/site-version.js";
import { SITE_VERSION, CONTENT_COMMIT, CONTENT_BUILT_AT } from "virtual:stelarith-version";

/**
 * 版本接口 —— 双轨版本体系（参考 acofork）：
 *   ① XK_* 字段：桌面端（星集控 / 安卓）OTA 契约，原样不动
 *      （latestVersion + build 整数比较、url + sha256 校验安装，minSupported 强制更新）
 *   ② site / commit / builtAt：本站自身版本 ——
 *      site 为 semver（package.json 权威），commit 为内容版本（git HEAD，
 *      构建期注入），builtAt 为该 commit 的提交时间。访客端轮询这三个字段，
 *      与页面加载时的构建期值比对，发现不一致即提示刷新（网页版热更新）。
 *
 * no-store：任何中间层（CF）缓存此响应都会让「发现新版本」失效。
 */
export async function GET() {
	return json(
		{
			// 兼容旧客户端（读 version 字段）
			version: XK_LATEST_VERSION,
			latestVersion: XK_LATEST_VERSION,
			build: XK_LATEST_BUILD,
			url: XK_RELEASE_URL,
			sha256: XK_RELEASE_SHA256,
			notes: XK_RELEASE_NOTES,
			minSupported: XK_MIN_SUPPORTED,
			updatedAt: XK_UPDATED_AT,
			service: "xingjikong",
			// ── 本站双轨版本（2026-10-23 版本号体系重构）────────────────────
			site: SITE_VERSION,
			commit: CONTENT_COMMIT,
			builtAt: CONTENT_BUILT_AT
		},
		{ headers: { "cache-control": "no-store" } }
	);
}
