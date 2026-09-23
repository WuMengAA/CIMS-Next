/**
 * 站点版本常量（#245 同步+自动更新）。
 *
 * 桌面端/安卓端经 GET /api/version 读取这三个字段，与本地版本比较后弹更新提示。
 * 改版时同步更新此处即可；build 用「日期+通道」便于一眼区分夜班/正式包。
 */
export const SITE_VERSION = "1.0.0";
export const SITE_BUILD = "20260921-nightly";
export const SITE_UPDATED_AT = "2026-09-21T23:00:00+08:00";
export const SITE_SERVICE = "stelarith-website";
