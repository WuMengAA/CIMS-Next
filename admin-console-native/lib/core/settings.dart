/// 星集控 · 应用设置（shared_preferences 持久化，键名对齐 web 面板语义）
library;

import 'dart:convert';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'identity.dart';
import 'log.dart';
import 'probe.dart' as probe;

/// copyWith 里用来区分「没传这个参数」与「显式传 null」的哨兵。
const Object _unset = Object();

/// 「网站账号登录」默认要连的站点地址。
///
/// 为什么必须有这个默认值：客户端装在**老师自己的电脑**上，而那台机器上没有网站服务
/// （127.0.0.1:8090 只在"客户端与服务端同机"时才通）。之前这里留空 → 登录页回落到
/// `http://127.0.0.1:8090`，老师点「用 Stelarith 网站账号登录」必然打不开，
/// 现象就是"登录非要走内网/本机不可"。
///
/// 出包给别的学校时用 `--dart-define=STELARITH_SITE=https://<本校站点>` 覆盖，
/// 不必改代码。
const String kDefaultSiteHost = String.fromEnvironment(
  'STELARITH_SITE',
  defaultValue: 'https://www.245959623.xyz',
);

/// 同机直连 CIMS 的默认管理端口（仅"客户端与服务端装在同一台机器"时成立，
/// 对普通老师的电脑无意义 —— 它只作为运维排障入口保留，不再是登录默认路径）。
const String kLocalMgmtHost = 'http://127.0.0.1:8097';

class Settings {
  final String mgmtHost; // 管理端口 8097（Bearer token）
  final String clientHost; // 客户端端口 8096
  final String extHost; // 扩展网关
  final String siteHost; // stelarith-website（协作/上报 + OAuth 授权）
  final String token;
  final String accountId;
  final String classId;
  final String taskSecret;
  /// 设备上报密钥（#T07.7 步骤 4）：截图回传走网站 ext captures 通道时，
  /// 带 `x-stelarith-device-secret` 头（与部署级 CONSOLE_DEVICE_REPORT_SECRET 一致）。
  /// 留空 = 截图只落本机、不上传（回传是可选能力，不能因此挡住本机截屏）。
  final String deviceSecret;
  final bool demo;
  final bool dark;
  /// 鉴权模式：'cims' = 直连 CIMS 密码登录；'website' = 网站 OAuth + 代理
  final String authMode;

  /// 本机被控：这台电脑是否接收集控端下发的指令（关机/重启/锁屏/截屏/音量/通知）。
  final bool agentEnabled;

  /// 本机在集控系统里的**稳定身份键**（= CIMS 的 client_id / uid）。
  ///
  /// ⚠️ 这是绑定键，**改名绝不可动它**——动它后端就按新 uid 建档，
  /// 旧设备记录会“凭空消失”，现象就是「设备改名变成新建」。
  /// 改名只改 [deviceName]（展示名）。首次运行从 `cims_agent_uid` 取一次后固化。
  final String deviceUid;

  /// 设备**展示名**（人类可读，界面上叫“设备名”）。改名只改它，
  /// 上报时带进 `host` / `display_name`，不变更绑定键 [deviceUid]。
  final String deviceName;

  /// 开机自动启动（被控机器必须自己回来，否则"人走了就管不了"）。
  final bool startWithWindows;

  /// 自动更新检查接口地址（可选，覆盖默认/站点地址）。
  ///
  /// 留空 = 用登录站点或内置默认站点的 `/api/version`；填了就直接向这个地址问版本。
  /// 优先级高于站点地址，主要用于“换更新源”或排障，**不在客户端写死任何域名**
  /// （域名由出包 `--dart-define=STELARITH_UPDATE_URL` 或本设置项决定）。
  final String updateUrl;

  /// 使用者身份快照（界面按它适配）。由服务端解算，见 core/identity.dart。
  /// 为 null = 拿不到身份 → 界面不收敛，全量平铺。
  final Identity? identity;

  const Settings({
    this.mgmtHost = '',
    this.clientHost = '',
    this.extHost = '',
    this.siteHost = '',
    this.token = '',
    this.accountId = '',
    this.classId = '',
    this.taskSecret = '',
    this.deviceSecret = '',
    this.demo = false,
    this.dark = true,
    this.authMode = 'cims',
    this.agentEnabled = false,
    this.deviceUid = '',
    this.deviceName = '',
    this.startWithWindows = false,
    this.updateUrl = '',
    this.identity,
  });

  Settings copyWith({
    String? mgmtHost,
    String? clientHost,
    String? extHost,
    String? siteHost,
    String? token,
    String? accountId,
    String? classId,
    String? taskSecret,
    String? deviceSecret,
    bool? demo,
    bool? dark,
    String? authMode,
    bool? agentEnabled,
    String? deviceUid,
    String? deviceName,
    bool? startWithWindows,
    String? updateUrl,
    /// 传 `null` 表示**显式清空**身份（退出登录）；不传则保持原值。
    Object? identity = _unset,
  }) {
    return Settings(
      mgmtHost: mgmtHost ?? this.mgmtHost,
      clientHost: clientHost ?? this.clientHost,
      extHost: extHost ?? this.extHost,
      siteHost: siteHost ?? this.siteHost,
      token: token ?? this.token,
      accountId: accountId ?? this.accountId,
      classId: classId ?? this.classId,
      taskSecret: taskSecret ?? this.taskSecret,
      deviceSecret: deviceSecret ?? this.deviceSecret,
      demo: demo ?? this.demo,
      dark: dark ?? this.dark,
      authMode: authMode ?? this.authMode,
      agentEnabled: agentEnabled ?? this.agentEnabled,
      deviceUid: deviceUid ?? this.deviceUid,
      deviceName: deviceName ?? this.deviceName,
      startWithWindows: startWithWindows ?? this.startWithWindows,
      updateUrl: updateUrl ?? this.updateUrl,
      identity: identical(identity, _unset) ? this.identity : identity as Identity?,
    );
  }

  /// 是否具备「真实账户上下文」：非演示 + 已登录 + 已选定账户。
  /// website 模式看 siteHost，cims 模式看 mgmtHost。
  bool get canUseBackend {
    if (demo) return false;
    if (token.isEmpty || accountId.isEmpty) return false;
    if (authMode == 'website') return siteHost.isNotEmpty;
    return mgmtHost.isNotEmpty;
  }

  /// 本机被控能否工作（null = 可以）。**只在 website 模式成立** —— 被控链路走
  /// 网站代理 `/api/console/cims/v1/client/...`，直连 CIMS 模式没有网站地址可用。
  /// 与 [DeviceAgent.blockedReason] 同一套判断（那里是运行期，这里是界面期）。
  String? get agentBlocker {
    if (demo) return '演示模式下不会真的连接教室';
    if (authMode != 'website') return '本机被控要用网站账号登录（当前是直连模式）';
    if (siteHost.isEmpty) return '没有填网站地址，无法上报本机状态';
    if (token.isEmpty) return '未登录，无法接收下发指令';
    if (deviceUid.isEmpty) return '设备名为空';
    return null;
  }
}

class SettingsNotifier extends StateNotifier<Settings> {
  SettingsNotifier() : super(const Settings());

  late SharedPreferences _prefs;

  /// 是否已完成过「首次启动自动探测」：完成即不再覆盖用户/自动配置。
  bool _setupDone = false;

  /// 只读暴露当前设置（API 层等非 UI 代码用，避免直接访问 protected 的 state）
  Settings get current => state;

  Future<void> load() async {
    _prefs = await SharedPreferences.getInstance();
    _setupDone = _prefs.getBool('cims_setup_done') ?? false;
    // 设备身份键（uid / client_id）：首次运行取一次后固化，改名绝不动它，
    // 否则后端会按新 uid 建档，旧设备“消失”（票 #246）。
    var uid = _prefs.getString('cims_agent_uid') ?? '';
    if (uid.trim().isEmpty) {
      uid = defaultDeviceUid();
      _prefs.setString('cims_agent_uid', uid);
    }
    // 展示名（界面里的“设备名”）独立持久化：默认与身份键相同，改名只改它。
    var name = _prefs.getString('cims_device_name') ?? '';
    if (name.trim().isEmpty) {
      name = uid;
      _prefs.setString('cims_device_name', name);
    }
    // 站点地址：**没存过 / 存成空串** 都回落到内置公网站点。
    //
    // 为什么把"空串"也算没填：老师根本不知道"站点地址"是什么东西，更不会去填。
    // 只要它能为空，就一定会有人把它弄空（划掉、误删、旧版残留），
    // 然后现象是「登录页看着有地址、但被控上报全部失败」（`blockedReason` 判 `isEmpty`）。
    // 宁可让"清空地址"这个操作失效，也不能让老师撞上一个空地址。
    final storedSite = (_prefs.getString('cims_site_host') ?? '').trim();
    state = Settings(
      mgmtHost: _prefs.getString('cims_mgmt') ?? '',
      clientHost: _prefs.getString('cims_client') ?? '',
      extHost: _prefs.getString('cims_ext') ?? '',
      siteHost: storedSite.isEmpty ? kDefaultSiteHost : storedSite,
      token: _prefs.getString('cims_token') ?? '',
      authMode: _prefs.getString('cims_auth_mode') ?? 'cims',
      accountId: _prefs.getString('cims_account_id') ?? '',
      classId: _prefs.getString('cims_class') ?? '',
      taskSecret: _prefs.getString('cims_task_secret') ?? '',
      deviceSecret: _prefs.getString('cims_device_secret') ?? '',
      demo: _prefs.getBool('cims_demo') ?? false,
      dark: _prefs.getBool('cims_dark') ?? true,
      agentEnabled: _prefs.getBool('cims_agent_enabled') ?? false,
      deviceUid: uid,
      deviceName: name,
      startWithWindows: _prefs.getBool('cims_agent_startup') ?? false,
      updateUrl: _prefs.getString('cims_update_url') ?? '',
      identity: _readIdentity(_prefs.getString('cims_identity')),
    );
  }

  /// 默认设备名 = 计算机名。空值/异常一律回落到一个固定串，
  /// 否则设备名会变成空字符串 → 后端收到 `/client//status` 这种畸形路径。
  static String defaultDeviceUid() {
    try {
      final h = Platform.localHostname.trim();
      if (h.isNotEmpty) return h;
    } catch (_) {}
    return 'xingjikong-pc';
  }

  /// 身份快照的持久化解析：坏数据一律当"没身份"（界面退回全量），不抛错。
  static Identity? _readIdentity(String? raw) {
    if (raw == null || raw.isEmpty) return null;
    try {
      final v = jsonDecode(raw);
      if (v is! Map) return null;
      final id = Identity.fromJson(Map<String, dynamic>.from(v));
      return id.role.isEmpty ? null : id;
    } catch (_) {
      return null;
    }
  }

  String _trim(String v) => v.trim().replaceAll(RegExp(r'/+$'), '');

  void setMgmtHost(String v) {
    final n = _trim(v);
    state = state.copyWith(mgmtHost: n);
    _prefs.setString('cims_mgmt', n);
    Log.i('管理地址 → ${n.isEmpty ? "（空）" : n}', 'settings');
  }

  void setClientHost(String v) {
    final n = _trim(v);
    state = state.copyWith(clientHost: n);
    _prefs.setString('cims_client', n);
  }

  void setExtHost(String v) {
    final n = _trim(v);
    state = state.copyWith(extHost: n);
    _prefs.setString('cims_ext', n);
  }

  void setSiteHost(String v) {
    final n = _trim(v);
    state = state.copyWith(siteHost: n);
    _prefs.setString('cims_site_host', n);
  }

  void setToken(String v) {
    state = state.copyWith(token: v);
    _prefs.setString('cims_token', v);
    // 只记长度：token 明文不得进日志
    Log.i(v.isEmpty ? 'token 已清空' : 'token 已更新（${v.length} 字符）', 'settings');
  }

  void setAuthMode(String v) {
    state = state.copyWith(authMode: v);
    _prefs.setString('cims_auth_mode', v);
    Log.i('鉴权模式 → $v', 'settings');
  }

  void setAccountId(String v) {
    state = state.copyWith(accountId: v);
    _prefs.setString('cims_account_id', v);
    // 账户上下文是 /account/{id}/... 的唯一来源，丢了就是满屏畸形路径
    Log.i('账户上下文 → ${v.isEmpty ? "（空）" : v}', 'settings');
  }

  void setClassId(String v) {
    state = state.copyWith(classId: v);
    _prefs.setString('cims_class', v);
  }

  void setTaskSecret(String v) {
    state = state.copyWith(taskSecret: v);
    _prefs.setString('cims_task_secret', v);
  }

  /// 设备上报密钥（截图回传鉴权，可选）。见 [Settings.deviceSecret]。
  void setDeviceSecret(String v) {
    state = state.copyWith(deviceSecret: v);
    _prefs.setString('cims_device_secret', v);
    Log.i(v.isEmpty ? '设备上报密钥已清空（截图不再回传）' : '设备上报密钥已更新（${v.length} 字符）', 'settings');
  }

  void setDemo(bool v) {
    state = state.copyWith(demo: v);
    _prefs.setBool('cims_demo', v);
    Log.i('演示模式 → $v', 'settings');
  }

  void setDark(bool v) {
    state = state.copyWith(dark: v);
    _prefs.setBool('cims_dark', v);
  }

  // ---- 本机被控 ----

  /// 开关本机被控。**持久化后由 DeviceAgent.sync() 真正起停**，这里只改配置。
  void setAgentEnabled(bool v) {
    state = state.copyWith(agentEnabled: v);
    _prefs.setBool('cims_agent_enabled', v);
    Log.i(v ? '本机被控已开启（这台电脑可被集控端管）' : '本机被控已关闭', 'agent');
  }

  /// 改**展示名**（界面上的“设备名”）。只改 [deviceName]，绝不改绑定键 [deviceUid]——
  /// 改名因此只是更新展示名，不会让后端按新 uid 建档（票 #246 方案 B）。
  void setDeviceName(String v) {
    final n = v.trim();
    state = state.copyWith(deviceName: n);
    _prefs.setString('cims_device_name', n);
    Log.i(n.isEmpty ? '设备展示名 →（空，回落身份键）' : '设备展示名 → $n', 'agent');
  }

  /// 改**绑定键**（uid / client_id）。仅在需要换设备身份时调用，改名流程不使用它——
  /// 改名走 [setDeviceName]，否则后端会按新 uid 建档（票 #246）。
  void setDeviceUid(String v) {
    final n = v.trim().isEmpty ? defaultDeviceUid() : v.trim();
    state = state.copyWith(deviceUid: n);
    _prefs.setString('cims_agent_uid', n);
    Log.i('设备身份键 → $n', 'agent');
  }

  void setStartWithWindows(bool v) {
    state = state.copyWith(startWithWindows: v);
    _prefs.setBool('cims_agent_startup', v);
  }

  /// 设更新检查接口地址（空 = 回落站点/默认站点）。持久化，方便远程运维换源。
  void setUpdateUrl(String v) {
    final n = _trim(v);
    state = state.copyWith(updateUrl: n);
    _prefs.setString('cims_update_url', n);
    Log.i(n.isEmpty ? '更新接口 →（回落默认）' : '更新接口 → $n', 'update');
  }

  /// 保存使用者身份快照（界面适配的唯一依据）。
  void setIdentity(Identity? id) {
    state = state.copyWith(identity: id);
    if (id == null) {
      _prefs.remove('cims_identity');
      Log.i('身份已清空 → 界面回到全量入口', 'settings');
      return;
    }
    _prefs.setString('cims_identity', jsonEncode(id.toJson()));
    Log.i('身份 → ${id.roleLabel}（${id.role}）'
        '${id.className.isNotEmpty ? " · ${id.className}" : ""}', 'settings');
  }

  void clearAuth() {
    state = state.copyWith(token: '', accountId: '', authMode: 'cims', identity: null);
    _prefs.remove('cims_token');
    _prefs.remove('cims_account_id');
    _prefs.remove('cims_identity');
    _prefs.setString('cims_auth_mode', 'cims');
    Log.w('登录态已清除（token + accountId + authMode + identity）', 'settings');
  }

  // ---- 后端自动探测（开箱即用）----

  /// 首次启动自动探测本机 CIMS 后端：仅当从未完成过探测时运行（避免覆盖远端配置）。
  /// 并行探测 127.0.0.1:8097（管理）与 :8096（客户端），可达即填入默认地址并持久化。
  /// 之后置 `_setupDone`，使后续启动不再重复探测。
  Future<void> detectLocalBackend() async {
    if (_setupDone) return;
    final results = await Future.wait([
      probe.probeHost('http://127.0.0.1:8097'),
      probe.probeHost('http://127.0.0.1:8096'),
    ]);
    final mgmt = results[0];
    final client = results[1];
    if (mgmt != -1) setMgmtHost('http://127.0.0.1:8097');
    if (client != -1) setClientHost('http://127.0.0.1:8096');
    _setupDone = true;
    await _prefs.setBool('cims_setup_done', true);
    Log.i(
        '首次启动自动探测本机后端：mgmt=$mgmt client=$client'
        '${mgmt != -1 ? '（已填入 8097）' : ''}'
        '${client != -1 ? '（已填入 8096）' : ''}',
        'settings');
  }

  /// 手动「重新探测本机后端」：不受 _setupDone 限制，可达即填入。
  /// 本机不可达时**不改写**现有配置（避免误清远端地址），返回是否发生了改动。
  Future<bool> rediscoverLocalBackend() async {
    final results = await Future.wait([
      probe.probeHost('http://127.0.0.1:8097'),
      probe.probeHost('http://127.0.0.1:8096'),
    ]);
    final mgmt = results[0];
    final client = results[1];
    var changed = false;
    if (mgmt != -1) {
      setMgmtHost('http://127.0.0.1:8097');
      changed = true;
    }
    if (client != -1) {
      setClientHost('http://127.0.0.1:8096');
      changed = true;
    }
    Log.i(
        '手动探测本机后端：mgmt=$mgmt client=$client'
        '${changed ? '（已填入可达端口）' : '（均不可达，未改动）'}',
        'settings');
    return changed;
  }
}

final settingsProvider =
    StateNotifierProvider<SettingsNotifier, Settings>((ref) => SettingsNotifier());
