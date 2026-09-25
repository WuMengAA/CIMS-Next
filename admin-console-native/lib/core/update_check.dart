/// 星集控 · 双端更新自检（桌面 / 安卓共用）
///
/// 启动时 + 每 30 分钟向站点 `GET /api/version` 拉最新版本，与本地版本比较，
/// 有更新就弹提示。接口由网站后端提供（网站 agent 负责部署），
/// 这里只做 best-effort：非 200 / 解析失败一律当“没拿到”，**绝不假装成功**。
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

import 'log.dart';
import 'settings.dart';

/// 本地版本（与 pubspec.yaml 的 `version: 1.0.1+2` 对齐；改 pubspec 时一并改这里）。
const String kLocalVersion = '1.0.1';
const int kLocalBuild = 2;

/// 版本接口路径（挂在站点根下）。改路径只动这里，不用改调用方。
const String kVersionApiPath = '/api/version';

/// 编译期覆写更新接口地址：`--dart-define=STELARITH_UPDATE_URL=https://...`
///
/// 为什么留这条环境变量出口：每所学校的站点域名不同，**桌面端里不许写死域名**。
/// 出包时由打包命令决定该向谁问版本，运维也能不改代码就换源。
const String kUpdateUrlOverride = String.fromEnvironment('STELARITH_UPDATE_URL');

/// 是否已经有自己的路径（给了完整接口 URL 就不再补 `/api/version`）。
bool _hasPath(String url) {
  final noScheme = url.replaceFirst(RegExp(r'^[a-zA-Z][a-zA-Z0-9+.-]*://'), '');
  return noScheme.contains('/');
}

String _joinVersionPath(String raw) {
  final clean = raw.trim().replaceAll(RegExp(r'/+$'), '');
  return _hasPath(clean) ? clean : '$clean$kVersionApiPath';
}

/// 拼版本检查 URL。**优先级链条（越靠前越优先）**：
///   ① [updateUrl] —— 用户在「设置 → 关于」里填的接口地址（运行期可改，排障最方便）；
///   ② [kUpdateUrlOverride] —— 出包时 `--dart-define=STELARITH_UPDATE_URL=...` 注入；
///   ③ [siteHost] —— 当前登录的学校站点（登了哪所学校就问哪所学校）；
///   ④ [kDefaultSiteHost] —— 内置兜底站点。
///
/// 前两级若已是完整 URL（带路径）则原样使用，只给域名时自动补 [kVersionApiPath]。
String versionCheckUrl(String siteHost, {String? updateUrl}) {
  final explicit = (updateUrl?.trim().isNotEmpty ?? false)
      ? updateUrl!.trim()
      : kUpdateUrlOverride;
  if (explicit.isNotEmpty) return _joinVersionPath(explicit);
  final base = siteHost.trim().isNotEmpty ? siteHost.trim() : kDefaultSiteHost;
  return _joinVersionPath(base);
}

/// 服务端返回的最新版本信息。
///
/// **与网站的接口契约**（站点侧 `GET /api/version` 返回体）：
/// ```json
/// {
///   "latestVersion": "1.2.0",   // 语义化版本号，必填 —— 缺失即视为无效响应
///   "url": "https://.../星集控-1.2.0.zip",  // 更新包/下载页，空则用站点地址
///   "notes": "修复了…",          // 更新说明，空则不展示
///   "minSupported": "1.1.0"     // 仍受支持的最低版本，低于它的客户端**必须**更新
/// }
/// ```
/// 另可带 `build`（单调整数，比对优先级高于版本号）与 `updatedAt`。
/// 旧写法 `{"version": "...", "build": N}` 仍然认 —— 两条命名都解析，避免换契约当天集体失效。
class AppVersion {
  final String version;
  final int build;
  final String url;
  final String notes;
  final String minSupported;
  final String updatedAt;
  /// 更新包 sha256（十六进制）。空 = 不校验（仅联调可用，生产必须填）。
  final String sha256;
  const AppVersion({
    required this.version,
    this.build = 0,
    this.url = '',
    this.notes = '',
    this.minSupported = '',
    this.updatedAt = '',
    this.sha256 = '',
  });

  factory AppVersion.fromJson(Map<String, dynamic> j) {
    final b = j['build'];
    // latestVersion 是新契约的主字段，version 是旧字段 —— 两者都认，优先新字段。
    final v = (j['latestVersion'] ?? j['version'] ?? '').toString().trim();
    return AppVersion(
      version: v,
      build: b is int ? b : int.tryParse(b?.toString() ?? '') ?? 0,
      url: (j['url'] ?? '').toString().trim(),
      notes: (j['notes'] ?? '').toString().trim(),
      minSupported: (j['minSupported'] ?? '').toString().trim(),
      updatedAt: (j['updatedAt'] ?? '').toString(),
      sha256: (j['sha256'] ?? '').toString().trim(),
    );
  }

  /// 缺版本号的一律当无效：**没有版本号就没法比对，绝不猜一个有更新**。
  bool get isValid => version.isNotEmpty;

  /// 本地版本是否已被服务端宣布不再支持 → 必须更新（UI 不给「稍后」）。
  bool get forced =>
      minSupported.isNotEmpty && _cmpVersion(kLocalVersion, minSupported) < 0;
}

/// 服务端版本是否比本地新：优先比 build（单调递增整数），build 相同再比版本号。
bool isNewer(AppVersion latest) {
  if (latest.build > kLocalBuild) return true;
  if (latest.build < kLocalBuild) return false;
  return _cmpVersion(latest.version, kLocalVersion) > 0;
}

int _cmpVersion(String a, String b) {
  final pa = a.split('.').map((e) => int.tryParse(e) ?? 0).toList();
  final pb = b.split('.').map((e) => int.tryParse(e) ?? 0).toList();
  for (var i = 0; i < 3; i++) {
    final x = pa.length > i ? pa[i] : 0;
    final y = pb.length > i ? pb[i] : 0;
    if (x != y) return x.compareTo(y);
  }
  return 0;
}

/// best-effort 拉取最新版本。HTTP 非 200 / 解析失败一律返回 null（不假装成功）。
Future<AppVersion?> fetchLatestVersion(
    {required String siteHost, String? updateUrl, http.Client? client}) async {
  final c = client ?? http.Client();
  final url = versionCheckUrl(siteHost, updateUrl: updateUrl);
  try {
    final res = await c
        .get(Uri.parse(url), headers: {'Accept': 'application/json'})
        .timeout(const Duration(seconds: 5));
    if (res.statusCode != 200) {
      // 200 才算数：曾出现代理把 GET 写成别的、回 200 + 空体“看着像成功”的坑。
      Log.i('版本检查：HTTP ${res.statusCode}（接口可能尚未部署）url=$url', 'update');
      return null;
    }
    final j = jsonDecode(res.body);
    if (j is! Map) return null;
    final v = AppVersion.fromJson(Map<String, dynamic>.from(j));
    if (!v.isValid) return null;
    return v;
  } catch (e) {
    Log.i('版本检查：请求失败（$e）——依赖网站 /api/version 部署，url=$url', 'update');
    return null;
  } finally {
    if (client == null) c.close();
  }
}

/// 更新检查状态（UI 订阅它来弹提示）。
class UpdateState {
  final AppVersion? latest;
  /// 服务端版本比本地新（含被 minSupported 宣布不再支持）。
  final bool hasUpdate;
  /// 本次检查是否真的拿到了服务端响应（false = 没拿到，UI 显示“暂无法检查”）。
  final bool reachable;
  final DateTime? checkedAt;
  const UpdateState(
      {this.latest, this.hasUpdate = false, this.reachable = false, this.checkedAt});

  UpdateState copyWith(
          {AppVersion? latest,
          bool? hasUpdate,
          bool? reachable,
          DateTime? checkedAt}) =>
      UpdateState(
        latest: latest ?? this.latest,
        hasUpdate: hasUpdate ?? this.hasUpdate,
        reachable: reachable ?? this.reachable,
        checkedAt: checkedAt ?? this.checkedAt,
      );
}

/// 启动一次检查 + 之后每 30 分钟轮一次。没有站点地址时也能跑（会用默认站点）。
class UpdateNotifier extends StateNotifier<UpdateState> {
  UpdateNotifier() : super(const UpdateState());
  Timer? _timer;
  String _siteHost = '';
  String? _updateUrl;

  void start({required String siteHost, String? updateUrl}) {
    _siteHost = siteHost;
    _updateUrl = updateUrl;
    checkNow();
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(minutes: 30), (_) => checkNow());
  }

  Future<void> checkNow() async {
    final v = await fetchLatestVersion(siteHost: _siteHost, updateUrl: _updateUrl);
    if (v == null) {
      // 没拿到：标 reachable=false（UI 显示“暂无法检查”），但保留上次 hasUpdate，
      // 不把“刚才还有更新”的提示贸然抹掉。
      state = state.copyWith(reachable: false, checkedAt: DateTime.now());
      return;
    }
    final newer = isNewer(v) || v.forced;
    state = state.copyWith(
        latest: v, hasUpdate: newer, reachable: true, checkedAt: DateTime.now());
    if (v.forced) {
      Log.i('当前版本已停止支持（minSupported=${v.minSupported}），需强更', 'update');
    } else if (newer) {
      Log.i('发现新版本：v${v.version} (build ${v.build})', 'update');
    } else {
      Log.i('已是最新：v${v.version}', 'update');
    }
  }

  /// 用户可以主动点「检查更新」（关于页）。
  Future<void> checkManually({required String siteHost, String? updateUrl}) async {
    _siteHost = siteHost;
    _updateUrl = updateUrl;
    await checkNow();
  }

  /// 用户点“稍后”后不再弹（本次会话内）。
  void dismiss() => state = state.copyWith(hasUpdate: false);

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }
}

final updateProvider =
    StateNotifierProvider<UpdateNotifier, UpdateState>((ref) => UpdateNotifier());
