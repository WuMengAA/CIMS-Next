/// 星集控 · CIMS API 客户端（语义对齐 web 面板 admin-console/src/api.js）
///
/// 契约（已在 CIMS-backend 源码核实）：
///   POST /user/auth                                     -> {token,...}
///   GET  /account/list                                  -> [{id,...}]
///   GET  /account/{acct}/client/list                    -> [uid,...]
///   GET  /account/{acct}/client/{uid}                   -> {uid,name,status,...}
///   POST /account/{acct}/client/{uid}/command/{restart|update-data|send-notification}
///   POST /account/{acct}/Components/write?name=xxx      -> 资源写
/// 任务链路：stelarith_task 经 send-notification 下发，设备侧插件验签执行本地动作。
///
/// 调试相关：
///   * 每个请求都进 [Log]（方法/路径/耗时/状态码/响应摘要），调试面板可见；
///   * 可注入 http.Client，便于单元测试打桩（见 test/api_client_test.dart）；
///   * [selfCheck] 一键跑通「账户→设备列表→设备详情」链路。
library;

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

import 'identity.dart';
import 'log.dart';
import 'models.dart';
import 'oauth.dart';
import 'probe.dart' as probe;
import 'settings.dart';

class ApiException implements Exception {
  final String message;
  ApiException(this.message);
  @override
  String toString() => message;
}

class CimsApi {
  final SettingsNotifier _settings;
  final http.Client _client;
  final bool _ownsClient;

  /// [client] 仅供测试注入打桩使用；生产留空（内部持有并在 dispose 时关闭）。
  CimsApi(this._settings, {http.Client? client})
      : _client = client ?? http.Client(),
        _ownsClient = client == null;

  Settings get s => _settings.current;

  void dispose() {
    if (_ownsClient) _client.close();
  }

  // ---- 基础请求 ----

  /// 请求基址：website 模式走网站 `/api/console/cims` 代理（复用 RBAC），
  /// cims 模式直连管理端口。两种模式后续 Authorization 头都带 token。
  String get apiBase {
    final s = this.s;
    if (s.authMode == 'website' && s.siteHost.isNotEmpty) {
      final host = s.siteHost.endsWith('/')
          ? s.siteHost.substring(0, s.siteHost.length - 1)
          : s.siteHost;
      return '$host/api/console/cims';
    }
    return s.mgmtHost;
  }

  Future<dynamic> reqTo(
    String host,
    String path, {
    String method = 'GET',
    Object? body,
    Map<String, String>? headers,
  }) async {
    if (host.isEmpty) throw ApiException('未配置后端地址');
    final uri = Uri.parse(host + path);
    final req = http.Request(method, uri);
    req.headers['Content-Type'] = 'application/json';
    if (s.token.isNotEmpty) req.headers['Authorization'] = 'Bearer ${s.token}';
    if (headers != null) req.headers.addAll(headers);
    if (body != null) req.body = jsonEncode(body);

    final sw = Stopwatch()..start();
    Log.api('→ $method $uri ${safeBody(path, body)}');
    try {
      final streamed =
          await _client.send(req).timeout(const Duration(seconds: 8));
      final res = await http.Response.fromStream(streamed)
          .timeout(const Duration(seconds: 8));
      sw.stop();
      if (res.statusCode == 401) {
        _settings.clearAuth();
        Log.api('← 401 ${sw.elapsedMilliseconds}ms 未授权，已清除登录态');
        throw ApiException('未授权，请重新登录');
      }
      if (res.statusCode >= 400) {
        Log.api('← ${res.statusCode} ${sw.elapsedMilliseconds}ms ${_clip(res.body, 300)}');
        throw ApiException('HTTP ${res.statusCode}');
      }
      Log.api('← ${res.statusCode} ${sw.elapsedMilliseconds}ms ${_clip(res.body, 300)}');
      if (res.bodyBytes.isEmpty) return <String, dynamic>{};
      return jsonDecode(utf8.decode(res.bodyBytes));
    } catch (e) {
      sw.stop();
      if (e is ApiException) rethrow;
      // 连接层失败也要留痕，否则「面板看起来正常但一条命令都没发出去」无法定位
      Log.e('× $method $uri 失败（${sw.elapsedMilliseconds}ms）：$e', 'api');
      rethrow;
    }
  }

  Future<dynamic> reqToManagement(
    String path, {
    String method = 'GET',
    Object? body,
  }) =>
      reqTo(apiBase, path, method: method, body: body);

  /// 请求体脱敏 + 截断（password 永远不进日志）
  /// 公开而非私有：单元测试要直接断言「密码没被写进日志」。
  static String safeBody(String path, Object? body) {
    if (body == null) return '';
    if (body is Map && body.containsKey('password')) {
      final m = Map<String, dynamic>.from(body);
      m['password'] = '***';
      return _clip(jsonEncode(m), 300);
    }
    return _clip(body.toString(), 300);
  }

  static String _clip(String s, [int n = 300]) =>
      s.length <= n ? s : '${s.substring(0, n)}…（共 ${s.length} 字符）';

  // ---- 认证 ----
  Future<Map<String, dynamic>> login(String host, String email, String password) async {
    _settings.setMgmtHost(host);
    if (host.isEmpty) {
      _settings.setDemo(true);
      Log.w('未填后端地址 → 进入演示模式', 'auth');
      return {'token': 'demo'};
    }
    _settings.setDemo(false);
    final r = await reqToManagement('/user/auth',
        method: 'POST', body: {'email': email, 'password': password});
    final map = r is Map<String, dynamic> ? r : <String, dynamic>{};
    if (map['requires_2fa'] == true) {
      throw ApiException('后端启用了 2FA，当前客户端未支持，请用非 2FA 账户');
    }
    _settings.setToken(map['token']?.toString() ?? '');
    _settings.setAuthMode('cims');
    await _pullAccountContext();
    return map;
  }

  /// 网站 OAuth 登录：拉起浏览器走「网站授权」，拿到网站会话令牌后走代理模式。
  /// 与 login() 互斥——一旦 OAuth 成功，apiBase 自动切到网站代理，不再直连 CIMS。
  Future<void> loginWithOAuth(String siteHost) async {
    final site = siteHost.trim();
    if (site.isEmpty) {
      _settings.setDemo(true);
      Log.w('未填网站地址 → 进入演示模式', 'auth');
      return;
    }
    _settings.setSiteHost(site);
    final result = await performOAuth(site);
    _settings.setToken(result.token);
    _settings.setAuthMode('website');
    Log.i('网站 OAuth 登录成功，已切换至代理模式', 'auth');
    await _pullAccountContext();
    // 紧接着取身份：界面要按身份摆功能（老师/电教委员/管理员各不相同）。
    await fetchIdentity();
  }

  /// 拉取使用者身份快照（网站 `GET /api/me` 的 `identity` 字段），用于界面适配。
  ///
  /// 三条原则：
  ///   · 只有 website 模式（有网站地址 + 令牌）才谈得上身份；直连 CIMS 返回 null；
  ///   · 拿不到就**保持 null**（界面不收敛、全量平铺）——绝不自己用 role 推权限，
  ///     否则迟早与服务端分叉，出现「界面点得了、服务端拒绝」；
  ///   · 失败只记日志、不抛错：身份是"锦上添花"，不该挡住登录后的主流程。
  Future<Identity?> fetchIdentity() async {
    final site = s.siteHost;
    if (site.isEmpty || s.token.isEmpty) return null;
    try {
      final r = await reqTo(site, '/api/me');
      if (r is! Map) return null;
      final raw = r['identity'];
      if (raw is! Map) {
        // 后端还没升级到带身份快照的版本：不是错误，只是没有身份可用。
        Log.w('/api/me 未返回 identity（后端版本较旧）→ 界面按全量入口展示', 'auth');
        return null;
      }
      final id = Identity.fromJson({
        ...Map<String, dynamic>.from(raw),
        'displayName': (r['displayName'] ?? r['username'] ?? '').toString(),
      });
      if (id.role.isEmpty) return null;
      _settings.setIdentity(id);
      return id;
    } catch (e) {
      Log.w('身份拉取失败（不影响登录）：$e', 'auth');
      return null;
    }
  }

  /// 登录后拉取账户列表并选定首个账户（刷新后 accountId 不归零，避免真实调用降级）。
  Future<void> _pullAccountContext() async {
    try {
      final accts = await reqToManagement('/account/list');
      if (accts is List && accts.isNotEmpty) {
        final first = accts.first;
        final id = first is Map ? (first['id'] ?? '').toString() : first.toString();
        if (id.isNotEmpty) {
          _settings.setAccountId(id);
        } else {
          Log.w('/account/list 首项没有 id 字段，账户上下文未建立', 'auth');
        }
      } else {
        Log.w('/account/list 返回空数组：该账号无归属账户，后续设备接口会全部哑火', 'auth');
      }
    } catch (e) {
      Log.w('登录后拉取账户列表失败：$e', 'auth');
    }
  }

  /// 是否具备真实后端（供 UI 空状态/离线提示）
  bool get canUseBackend => s.canUseBackend;

  /// 连通性探活（不进日志、不打授权头）。返回 HTTP 状态码，失败/超时返回 -1。
  /// 用于调试页端口检查与启动自动探测的语义对齐。
  static Future<int> probeHost(String host,
          {Duration timeout = const Duration(seconds: 2)}) =>
      probe.probeHost(host, timeout: timeout);

  // ---- 设备 ----
  Future<List<CimsDevice>> listDevices() async {
    if (!s.canUseBackend) return const [];
    try {
      final uids = await reqToManagement('/account/${s.accountId}/client/list');
      if (uids is! List) return const [];
      final details = await Future.wait(uids.map((u) async {
        final uid = u.toString();
        try {
          final d = await reqToManagement('/account/${s.accountId}/client/$uid');
          return d is Map<String, dynamic>
              ? CimsDevice.fromJson({...d, 'uid': uid})
              : CimsDevice(uid: uid, name: uid, online: false, ip: '', last: '');
        } catch (_) {
          return CimsDevice(uid: uid, name: uid, online: false, ip: '', last: '');
        }
      }));
      return details;
    } catch (_) {
      return const [];
    }
  }

  // ---- 设备动作 ----
  /// CIMS 原生指令端点（restart / refresh→update-data / notify→send-notification）
  Future<dynamic> deviceAction(String uid, String action, [Map<String, dynamic>? args]) async {
    if (!s.canUseBackend) return {'status': 'success', 'message': '（演示）指令已模拟下发'};
    final ep = {
      'restart': 'restart',
      'refresh': 'update-data',
      'sync': 'update-data',
      'notify': 'send-notification',
    }[action];
    if (ep != null) {
      final body = action == 'notify' ? {'MessageContent': '来自集控客户端的提醒'} : null;
      return reqToManagement(
          '/account/${s.accountId}/client/$uid/command/$ep',
          method: 'POST',
          body: body);
    }
    // lock / screenshot / 音量 / 文件：统一走 stelarith_task 通知链路
    if (action == 'lock' || action == 'screenshot') {
      return sendTask(uid, action, scope: 'device');
    }
    // 音量：带 volume 参数走任务链路
    if (action == 'set_volume') {
      return sendTask(uid, action, scope: 'device', payload: {'volume': args?['volume'] ?? 60});
    }
    throw ApiException('不支持的动作：$action');
  }

  /// 下发 stelarith_task（HMAC 签名，设备侧插件验签后执行本地动作）
  Future<dynamic> sendTask(
    String uid,
    String action, {
    String scope = 'device',
    Map<String, dynamic>? payload,
  }) async {
    if (!s.canUseBackend) return {'status': 'demo', 'message': '（演示）已模拟下发任务'};
    final ts = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    final token = await signTask(action, ts);
    final task = <String, dynamic>{
      'action': action,
      'token': token,
      'scope': scope,
      'ts': ts,
      'payload': ?payload,
    };
    final body = {'MessageContent': jsonEncode({'stelarith_task': task})};
    return reqToManagement(
        '/account/${s.accountId}/client/$uid/command/send-notification',
        method: 'POST',
        body: body);
  }

  /// HMAC-SHA256 任务令牌：hex(HMAC_SHA256(action + "|" + ts, secret))
  /// 未配置 secret 时退回时间戳占位（仅联调用，不可用于生产）。
  Future<String> signTask(String action, int ts) async {
    if (s.taskSecret.isEmpty) {
      Log.w('未配置任务密钥：stelarith_task 使用占位令牌，设备侧验签会失败', 'task');
      return DateTime.now().millisecondsSinceEpoch.toString();
    }
    final data = utf8.encode('$action|$ts');
    final key = utf8.encode(s.taskSecret);
    return sha256.convert(Hmac(sha256, key).convert(data).bytes).toString();
  }

  // ---- 广播通知 ----
  /// 下发通知（v2.2 增强：标题/正文分离、通知方式、时长、班级范围）。
  ///
  /// [kind]：island（岛内）/ popup（弹窗，可确认回复）/ fullscreen（全屏紧急）。
  /// [title] / [body]：标题与正文（设备端按 kind 呈现）。
  /// [durationSeconds]：显示时长（0 = 默认）。
  /// [requireAck]：popup/fullscreen 是否需要手动确认。
  /// [onlyUids]：null = 全校。
  Future<int> sendNotice(
    String title, {
    String body = '',
    String scope = '全校',
    String kind = 'island',
    int durationSeconds = 0,
    bool requireAck = false,
    List<String>? onlyUids,
  }) async {
    if (!s.canUseBackend) return 0;
    final all = await reqToManagement('/account/' + s.accountId + '/client/list');
    if (all is! List) return 0;
    final uids = onlyUids == null
        ? all
        : all.where((u) => onlyUids.contains(u.toString())).toList();
    var sent = 0;
    for (final u in uids) {
      try {
        // v2.2 通知方式 → 教室端呈现映射：
        //   island      → 官方通知（ClassIsland 播报/滚动条）；
        //   popup       → stelarith_task interactive_notice（自建置顶弹窗：确认/回复/回执）；
        //   fullscreen  → stelarith_task fullscreen_notice（自建真全屏 + 二次确认 + 回执）。
        // 弹窗/全屏不依赖 ClassIsland 官方能力（官方 NotificationContent 只有纯展示），
        // 弹窗能力由插件自建 Avalonia 窗口提供 —— 这正是用户 2026-09-26 澄清的方向。
        if (kind == 'popup' || kind == 'fullscreen') {
          final action = kind == 'popup' ? 'interactive_notice' : 'fullscreen_notice';
          final res = await sendTask(
            u.toString(),
            action,
            scope: 'device',
            payload: {
              'notice_id': DateTime.now().millisecondsSinceEpoch.toString(),
              'title': title,
              'body': body.isEmpty ? title : body,
              if (requireAck) 'require_ack': true,
              if (kind == 'fullscreen' && durationSeconds > 0)
                'auto_dismiss_seconds': durationSeconds,
            },
          );
          if (res is Map && (res['status'] == 'success' || res['message'] == '通知已递送')) {
            sent++;
          }
        } else {
          final payload = <String, dynamic>{
            'MessageMask': title,
            'MessageContent': body.isEmpty ? title : body,
            'DurationSeconds': durationSeconds > 0 ? durationSeconds : 5.0,
            'RepeatCounts': 1,
          };
          await reqToManagement(
              '/account/' + s.accountId + '/client/' + u.toString() + '/command/send-notification',
              method: 'POST',
              body: payload);
          sent++;
        }
      } catch (_) {}
    }
    Log.i('通知「' + title + '」（' + kind + '）送达 ' + sent.toString() + '/' + uids.length.toString() + ' 台', 'notice');
    try {
      await reqTo(s.extHost, '/notices',
          method: 'POST', body: {'title': title, 'scope': scope, 'sent': sent});
    } catch (_) {}
    return sent;
  }
  // ---- 设备截图回传（#T07.7 步骤 4）----
  /// 拉取设备回传的截图：GET `{site}/api/console/ext/captures?uid=xxx`（Bearer 会话）。
  /// 返回 `{at, bytes, image_base64}`；没报过/已过期/失败一律返回 null（**不抛**——
  /// 这是轮询语义：控制侧点「远程截图」后要反复问直到出图或超时）。
  Future<Map<String, dynamic>?> getCapture(String uid) async {
    final site = s.siteHost;
    if (site.isEmpty || s.token.isEmpty || uid.isEmpty) return null;
    try {
      final r = await reqTo(
          site, '/api/console/ext/captures?uid=${Uri.encodeComponent(uid)}');
      if (r is! Map) return null;
      final c = r['capture'];
      return c is Map<String, dynamic> ? c : null;
    } catch (_) {
      return null;
    }
  }

  // ---- 回复收件箱 / 执行回执（v2.1 双向消息闭环）----
  //
  // 被控端（教室大屏/桌面端）对互动通知的「确认/回复」回执落在 CIMS notice_replies 表，
  // 对指令的「执行结果」回执落在 command_completions 表 —— 操控端据此看到
  // 「谁确认了、回了什么、哪台设备执行了（成功/失败）」，而不是只有一条「已下发」。
  // 走管理端 /class/* 端点（Bearer 鉴权，租户经令牌上下文识别）。

  /// 拉取本租户的互动通知回执（确认/回复）。
  /// [noticeId] 过滤单条广播；返回 null = 接口不可用/无数据（不抛，页面显示空态）。
  Future<List<NoticeReply>?> listNoticeReplies({String noticeId = ''}) async {
    if (!s.canUseBackend) return null;
    try {
      final q = noticeId.isNotEmpty ? '?notice_id=' + Uri.encodeComponent(noticeId) : '';
      final r = await reqToManagement('/class/notice-replies' + q);
      if (r is! Map) return null;
      final list = r['replies'];
      if (list is! List) return null;
      return list
          .whereType<Map>()
          .map((e) => NoticeReply.fromJson(Map<String, dynamic>.from(e)))
          .whereType<NoticeReply>()
          .toList();
    } catch (_) {
      return null;
    }
  }

  /// 拉取本租户的设备执行回执（截图/锁屏/远控等动作结果）。
  /// [clientId] / [action] 可过滤；返回 null = 接口不可用（不抛）。
  Future<List<CommandCompletion>?> listCompletions({
    String clientId = '',
    String action = '',
  }) async {
    if (!s.canUseBackend) return null;
    try {
      final q = <String>[
        if (clientId.isNotEmpty) 'client_id=' + Uri.encodeComponent(clientId),
        if (action.isNotEmpty) 'action=' + Uri.encodeComponent(action),
      ].join('&');
      final r = await reqToManagement('/class/command-completions' + (q.isEmpty ? '' : '?' + q));
      if (r is! Map) return null;
      final list = r['completions'];
      if (list is! List) return null;
      return list
          .whereType<Map>()
          .map((e) => CommandCompletion.fromJson(Map<String, dynamic>.from(e)))
          .whereType<CommandCompletion>()
          .toList();
    } catch (_) {
      return null;
    }
  }

  /// 拉取最近「新截图就绪」事件（ext capture-events；操控端主动感知设备回传截图）。
  /// 返回 [{uid, at}]；接口不可用/无权限返回 null（不抛）。
  Future<List<Map<String, dynamic>>?> listCaptureEvents() async {
    if (!s.canUseBackend) return null;
    final site = s.siteHost.trim();
    if (site.isEmpty || s.token.isEmpty) return null;
    try {
      final r = await reqTo(site, '/api/console/ext/capture-events');
      if (r is! Map) return null;
      final list = r['events'];
      if (list is! List) return null;
      return list.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
    } catch (_) {
      return null;
    }
  }


  // ---- 文件传输 v2（2026-09-25 班级系统配套）----
  //
  // 旧 V1 只发元数据（name/size/sha256），文件本体从未离开发送机，设备永远收不到。
  // V2 三步：① uploadFile 把实体传到网站（multipart，≤100MB）；
  //          ② pushFile 让服务端代推 file_push 指令到目标班级的设备；
  //          ③ fileDeliveries 轮询逐台回执（pending → acked/failed），
  //            「发完没音讯」在发送端就此终结——桌面上一台一台亮出来。

  /// 拉取网站真实班级列表（GET /api/classes，唯一来源 CIMS，绝不掺演示班）。
  /// 返回 [{class_id, name, ...}]；CIMS 不可达 → null（调用方必须明示错误，禁假列表）。
  Future<List<Map<String, dynamic>>?> listSiteClasses() async {
    final site = s.siteHost;
    if (site.isEmpty || s.token.isEmpty) return null;
    try {
      final r = await reqTo(site, '/api/classes');
      if (r is! Map) return null;
      final items = r['classes'];
      if (items is! List) return null;
      return items
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
    } catch (_) {
      return null;
    }
  }

  /// 上传文件实体（multipart，Bearer 会话）。
  /// 返回 file_objects 行：{id, name, size, sha256, kind}；失败抛 ApiException。
  Future<Map<String, dynamic>> uploadFile(String path, {String kind = 'file'}) async {
    final site = s.siteHost;
    if (site.isEmpty || s.token.isEmpty) {
      throw ApiException('未登录网站（网站模式才支持传文件）');
    }
    final uri = Uri.parse('$site/api/console/ext/files');
    final req = http.MultipartRequest('POST', uri)
      ..headers['Authorization'] = 'Bearer ${s.token}'
      ..fields['kind'] = kind
      ..files.add(await http.MultipartFile.fromPath('file', path));
    Log.api('→ POST $uri ${_clip(path, 120)}');
    final sw = Stopwatch()..start();
    final streamed =
        await _client.send(req).timeout(const Duration(minutes: 10));
    final res = await http.Response.fromStream(streamed)
        .timeout(const Duration(minutes: 10));
    sw.stop();
    if (res.statusCode == 401) {
      _settings.clearAuth();
      throw ApiException('未授权，请重新登录');
    }
    if (res.statusCode >= 400) {
      final why = _clip(utf8.decode(res.bodyBytes), 200);
      throw ApiException('上传失败（HTTP ${res.statusCode}）$why');
    }
    Log.api('← ${res.statusCode} ${sw.elapsedMilliseconds}ms 上传完成');
    final r = jsonDecode(utf8.decode(res.bodyBytes));
    final f = (r is Map) ? r['file'] : null;
    if (f is! Map || (f['id'] ?? '').toString().isEmpty) {
      throw ApiException('上传响应缺少文件 id');
    }
    return Map<String, dynamic>.from(f);
  }

  /// 推送已上传的文件到目标班级/设备（服务端代推 file_push 指令 + 逐台建档回执）。
  /// [classes] / [uids] 至少给一个；超范围（未绑定班级）服务端 403 直接拒绝。
  Future<Map<String, dynamic>> pushFile(
    String fileId, {
    List<String> classes = const [],
    List<String> uids = const [],
  }) async {
    final site = s.siteHost;
    if (site.isEmpty || s.token.isEmpty) throw ApiException('未登录网站');
    // 服务端逐台下发虽已并发化，目标多时仍可能超过通用 8s —— 给足 120s。
    final r = await reqTo(site, '/api/console/ext/file-push',
        method: 'POST',
        body: {'file_id': fileId, 'classes': classes, 'uids': uids});
    return (r is Map) ? Map<String, dynamic>.from(r) : <String, dynamic>{};
  }

  /// 拉取某文件的逐台送达回执：[{uid, class_id, state, detail, updated_at}]。
  /// state ∈ pending（等待设备）/ acked（已接收）/ failed（失败，detail 有人话原因）。
  Future<List<Map<String, dynamic>>> fileDeliveries(String fileId) async {
    final site = s.siteHost;
    if (site.isEmpty || s.token.isEmpty || fileId.isEmpty) return const [];
    final r = await reqTo(
        site, '/api/console/ext/file-deliveries?file=${Uri.encodeQueryComponent(fileId)}');
    if (r is! Map) return const [];
    final rows = r['deliveries'];
    if (rows is! List) return const [];
    return rows
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
  }

  // ---- 扩展网关（协作/上报，可选）----
  Future<List<NoticeItem>> listNotices() async {
    if (s.demo || s.extHost.isEmpty) return const [];
    try {
      final r = await reqTo(s.extHost, '/notices');
      if (r is! List) return const [];
      return r.map((e) {
        final m = e is Map<String, dynamic> ? e : <String, dynamic>{};
        return NoticeItem(
          id: (m['id'] ?? '').toString(),
          title: (m['title'] ?? '').toString(),
          scope: (m['scope'] ?? '').toString(),
          at: (m['at'] ?? m['createdAt'] ?? '').toString(),
        );
      }).toList();
    } catch (_) {
      return const [];
    }
  }

  // ---- 远程控制（#T07.7 步骤 5：桌面端远控入口）----
  /// 下发远程控制指令：POST stelarith_task `remote_control_start`（HMAC 签名），
  /// 教室端代理按需启 VNC 后会把 {ip,port,token} 回报到网站 ext 网关。
  Future<dynamic> deviceRemoteStart(String uid) =>
      sendTask(uid, 'remote_control_start', scope: 'class');

  /// 结束远程控制会话：下发 stop + 顺手清掉网关里的会话回执（与 web 面板一致）。
  Future<dynamic> deviceRemoteStop(String uid) async {
    try {
      final r = await sendTask(uid, 'remote_control_stop', scope: 'class');
      try {
        await reqTo(
            s.siteHost,
            '/api/console/ext/vnc-session?uid=${Uri.encodeComponent(uid)}',
            method: 'DELETE');
      } catch (_) {}
      return r;
    } catch (e) {
      rethrow;
    }
  }

  /// 轮询扩展网关取设备最新 VNC 会话回执：`{ip, port, token}` 或 null（**不抛**——
  /// 轮询语义：远控下发后要反复问直到出会话或超时）。
  ///
  /// ⚠️ 双 key（#T07.7 步骤 5 脱节修复）：CIMS 下发指令用 client_id（lab-pc-001），
  /// 教室端代理回报用 device_uid（主机名 n7-20091211）——是不同的串，只查 uid
  /// 会永远拿不到回执。先按 uid 查，miss 再按 host 查；服务端 key 已小写归一化，
  /// host 传大写也能命中。与 web 面板 deviceRemoteStatus 同一套语义。
  Future<Map<String, dynamic>?> deviceRemoteStatus(String uid, {String? host}) async {
    final site = s.siteHost;
    if (site.isEmpty || s.token.isEmpty || uid.isEmpty) return null;
    try {
      final q = '/api/console/ext/vnc-session?uid=${Uri.encodeComponent(uid)}'
          '${host != null && host != uid ? '&host=${Uri.encodeComponent(host)}' : ''}';
      final r = await reqTo(site, q);
      if (r is! Map) return null;
      final sess = r['session'];
      return sess is Map<String, dynamic> ? sess : null;
    } catch (_) {
      return null;
    }
  }

  // ---- 自助切班（T07.8 棒 3：class_swap_routes 直连）----
  /// 班级实体目录（/class/list）：发起互换的 A/B 下拉选项。
  /// CIMS 返回**数组**（[{class_id, name, ...}]）；代理原样透传。
  /// 拿不到返回空列表，调用方给出加载失败提示。
  Future<List<Map<String, dynamic>>> listClassEntities() async {
    if (!s.canUseBackend) return const [];
    try {
      final r = await reqToManagement('/class/list');
      if (r is List) {
        return r
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
      }
      if (r is Map) {
        final items = r['classes'];
        if (items is List) {
          return items
              .whereType<Map>()
              .map((e) => Map<String, dynamic>.from(e))
              .toList();
        }
      }
      return const [];
    } catch (_) {
      return const [];
    }
  }

  /// 互换申请列表（GET /class/swap）。status 留空 = 全部。
  Future<List<Map<String, dynamic>>> swapList({String status = ''}) async {
    if (!s.canUseBackend) return const [];
    try {
      final q = status.isEmpty
          ? '/class/swap'
          : '/class/swap?status=${Uri.encodeComponent(status)}';
      final r = await reqToManagement(q);
      if (r is! Map) return const [];
      final items = r['items'];
      if (items is! List) return const [];
      return items
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
    } catch (_) {
      return const [];
    }
  }

  /// 发起互换申请（POST /class/swap）。
  /// [swapType] swap=互换 / oneway=单切；[start]/[end] 为 ISO8601 或 null（永久）。
  /// 返回服务端响应 Map；抛 ApiException = 被拒（422 冲突 / 403 无权限等）。
  Future<Map<String, dynamic>> swapCreate({
    required String fromClassId,
    required String toClassId,
    String swapType = 'swap',
    String reason = '',
    String? effectiveStartAt,
    String? effectiveEndAt,
  }) async {
    final body = <String, dynamic>{
      'from_class_id': fromClassId,
      'to_class_id': toClassId,
      'swap_type': swapType,
      'reason': reason,
      'effective_start_at': ?effectiveStartAt,
      'effective_end_at': ?effectiveEndAt,
    };
    final r = await reqToManagement('/class/swap',
        method: 'POST', body: body);
    if (r is! Map) return <String, dynamic>{};
    return Map<String, dynamic>.from(r);
  }

  /// 审批/驳回/撤销/回退（manage 档 approve/reject，control 档 cancel/rollback）。
  Future<Map<String, dynamic>> swapAct(
    String swapId,
    String action, {
    String reason = '',
  }) async {
    final r = await reqToManagement('/class/swap/$swapId/$action',
        method: 'POST',
        body: action == 'reject' ? {'reason': reason} : <String, dynamic>{});
    if (r is! Map) return <String, dynamic>{};
    return Map<String, dynamic>.from(r);
  }

  /// 读审批开关（requires_approval）。
  Future<bool> swapRequiresApproval() async {
    if (!s.canUseBackend) return false;
    try {
      final r = await reqToManagement('/class/swap/config');
      if (r is Map && r['requires_approval'] == true) return true;
    } catch (_) {}
    return false;
  }

  /// 读面板持久化设置（网站 ext settings 端点，viewConsole 即可读）：远程/媒体参数。
  /// 返回 null = 拿不到（后端旧版/未登录/网络问题）——调用方按缺省处理，不抛。
  Future<Map<String, dynamic>?> fetchExtSettings() async {
    final site = s.siteHost;
    if (site.isEmpty || s.token.isEmpty) return null;
    try {
      final r = await reqTo(site, '/api/console/ext/settings');
      if (r is! Map) return null;
      final st = r['settings'];
      return st is Map<String, dynamic> ? st : null;
    } catch (_) {
      return null;
    }
  }

  // ---- 调试自检 ----
  /// 依次验证：账户列表 → 设备列表 → 首个设备详情 → 扩展网关（若配置）。
  /// 每步独立计时、失败不中断，供调试面板与 CLI 自检脚本展示。
  Future<List<CheckStep>> selfCheck() async {
    final steps = <CheckStep>[];
    if (s.mgmtHost.isEmpty) {
      steps.add(const CheckStep(
          name: '管理端口连通性',
          ok: false,
          ms: 0,
          detail: '未配置管理端口地址（设置页填 8097）'));
      return steps;
    }
    steps.add(await _step('GET /account/list', () => reqToManagement('/account/list')));
    if (!s.canUseBackend) {
      steps.add(const CheckStep(
          name: '账户上下文',
          ok: false,
          ms: 0,
          detail: '缺少 token 或 accountId —— /account/{id}/... 会是畸形路径'));
      return steps;
    }
    final listStep = await _step('GET /account/{id}/client/list',
        () => reqToManagement('/account/${s.accountId}/client/list'));
    steps.add(listStep);
    if (listStep.ok) {
      final uids = await _uidsOrEmpty();
      if (uids.isEmpty) {
        steps.add(const CheckStep(
            name: '设备详情', ok: false, ms: 0, detail: '账户下没有注册设备（0 台）'));
      } else {
        steps.add(await _step('GET client/${uids.first} 详情',
            () => reqToManagement('/account/${s.accountId}/client/${uids.first}')));
      }
    }
    if (s.extHost.isNotEmpty) {
      steps.add(await _step('扩展网关 GET /notices', () => reqTo(s.extHost, '/notices')));
    }
    return steps;
  }

  Future<List<String>> _uidsOrEmpty() async {
    try {
      final uids = await reqToManagement('/account/${s.accountId}/client/list');
      return uids is List ? uids.map((e) => e.toString()).toList() : <String>[];
    } catch (_) {
      return <String>[];
    }
  }

  Future<CheckStep> _step(String name, Future<dynamic> Function() fn) async {
    final sw = Stopwatch()..start();
    try {
      final r = await fn();
      sw.stop();
      return CheckStep(name: name, ok: true, ms: sw.elapsedMilliseconds, detail: _brief(r));
    } catch (e) {
      sw.stop();
      return CheckStep(
          name: name, ok: false, ms: sw.elapsedMilliseconds, detail: e.toString());
    }
  }

  static String _brief(dynamic r) {
    if (r is List) return '数组 ${r.length} 项';
    if (r is Map) return _clip(jsonEncode(r), 200);
    return _clip(r.toString(), 200);
  }

  /// 计算文件 SHA-256（文件传输任务签名用）
  static Future<String> sha256OfBytes(Uint8List bytes) async {
    return sha256.convert(bytes).toString();
  }

  /// 流式计算文件 SHA-256：**不把整个文件读进内存**，大文件/多文件也不会爆 RAM。
  /// V1 文件传输只需 name/size/sha256 元数据下发，实体由设备侧拉取，故绝不该 withData 全量读入。
  static Future<String> sha256OfFile(String path) async {
    final digest = await sha256.bind(File(path).openRead()).first;
    return digest.toString();
  }
}

final apiProvider = Provider<CimsApi>((ref) {
  final settings = ref.watch(settingsProvider.notifier);
  return CimsApi(settings);
});
