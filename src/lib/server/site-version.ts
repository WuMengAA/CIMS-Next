/**
 * 桌面端（星集控 xingjikong）OTA 发布清单。
 *
 * 与 Flutter 端 update_check.dart 的 AppVersion 解析契约对齐：
 *   latestVersion + build(整数) 用于比较，url 是更新包地址，
 *   sha256 用于下载后校验（防损坏/被篡改），minSupported 以下的客户端强制更新。
 * 出新版时：改下面 7 个常量 + 把新包放到 static/downloads/，再重启/重新同步站点即可。
 * 注意 build 必须是**整数**（单调递增），不要写成 "20260921-nightly" 这类字符串——
 * 客户端对字符串 build 会解析成 0，比较逻辑会失效。
 *
 * 站点自身版本（semver / git commit 内容版本）不在此文件：
 * semver 以 package.json + changelog.json 为权威源，commit 由 vite 插件
 * （virtual:stelarith-version）构建期注入，见 GET /api/version 的响应字段。
 */
export const XK_LATEST_VERSION = "1.0.7";
export const XK_LATEST_BUILD = 9;
export const XK_RELEASE_URL =
  "https://www.245959623.xyz/downloads/xingjikong-setup.exe";
export const XK_RELEASE_SHA256 =
  "f4dddf1a3faf377cf5bb5299979860d474bbf034f0064ca0e82bc9162463be66";
export const XK_RELEASE_NOTES =
  "本次修复：全屏通知点「关闭」后卡住退不出（现 1 秒内可关，并支持 Esc 键）；检测到新版本时更新提示变成灰块、「立即更新」按钮点不到，导致无法升级；长期后台空转轮询引起的界面卡顿。另新增：在集控面板远程查看本机运行日志。";
export const XK_MIN_SUPPORTED = "1.0.0";
export const XK_UPDATED_AT = "2026-09-28T23:04:00+08:00";
