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

/**
 * 桌面端（星集控 xingjikong）OTA 发布清单。
 *
 * 与 Flutter 端 update_check.dart 的 AppVersion 解析契约对齐：
 *   latestVersion + build(整数) 用于比较，url 是更新包地址，
 *   sha256 用于下载后校验（防损坏/被篡改），minSupported 以下的客户端强制更新。
 * 出新版时：改下面 7 个常量 + 把新包放到 static/downloads/，再重启/重新同步站点即可。
 * 注意 build 必须是**整数**（单调递增），不要写成 "20260921-nightly" 这类字符串——
 * 客户端对字符串 build 会解析成 0，比较逻辑会失效。
 */
export const XK_LATEST_VERSION = "1.0.1";
export const XK_LATEST_BUILD = 2;
export const XK_RELEASE_URL =
  "https://www.245959623.xyz/downloads/xingjikong-release.zip";
export const XK_RELEASE_SHA256 =
  "55c67246f43ae2e8cd959048b955b4f0205e84a385ab97c1a5e3c34b5263e4a2";
export const XK_RELEASE_NOTES =
  "修复指令回执（ack）假阳性、内置 OTA 一键更新，稳定性提升。";
export const XK_MIN_SUPPORTED = "1.0.0";
export const XK_UPDATED_AT = "2026-09-25T12:00:00+08:00";
