/// 星集控 · 本机被控（设备代理）
///
/// 让**这台 Windows 电脑**成为集控系统里的一个可管设备：
///   ① 周期上报状态  → 管理面板能看见它在不在线；
///   ② 轮询下发指令  → 关机 / 重启 / 锁屏 / 调音量 / 截屏 / 发通知；
///   ③ 逐条回报结果  → 面板能区分「成了」和「没成」。
///
/// ## 为什么走网站代理而不是直连 8096
/// `{site}/api/console/cims/v1/client/{uid}/...` 这条代理：
///   · 复用登录时拿到的网站令牌与 RBAC —— 桌面端**不需要知道租户 slug / 基域**；
///   · 网站侧用 node:http 补 `Host: <slug>.<BaseDomain>`，内网部署同样可用；
///   · 教室端那套「直连租户子域」的写法在老师自己的电脑上不成立（DNS/隧道都可能不通）。
/// 代价：必须用**网站账号**登录（`authMode == website`）。直连 CIMS 模式没有网站地址，
/// 本机被控不可用 —— 界面上直说，不静默降级。
///
/// ## 频率与退避（这条是硬约束，不是保守）
/// 轮询 4s、上报 20s；**任何 4xx/5xx 都指数退避到最长 2 分钟**。
/// 因为 CIMS 的 `CCProtectMiddleware` 会在同 IP 60s 内累计 ≥5 次 ≥400 响应后
/// 把本机 IP 封 60s，而**封禁期间命令轮询一起被拒** —— 一旦被打成封禁，
/// 这台机器就"失联"了，还得人工去善后。
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

import 'log.dart';
import 'screen_shot.dart';
import 'settings.dart';

// ---------------------------------------------------------------------------
// 数据模型
// ---------------------------------------------------------------------------

/// 一条从命令队列取回来的指令（drain 语义：取回即已被后端标记为 delivered）。
class DeviceCommand {
  final int id;
  final String type;
  final String payload;
  const DeviceCommand({required this.id, required this.type, required this.payload});

  factory DeviceCommand.fromJson(Map<String, dynamic> m) => DeviceCommand(
        id: (m['id'] as num?)?.toInt() ?? -1,
        type: (m['type'] ?? '').toString(),
        payload: (m['payload'] ?? '').toString(),
      );
}

/// 从 `stelarith_task` 里解出来的本机动作。
class StelarithTask {
  final String action;
  final Map<String, dynamic> params;
  final String scope;
  const StelarithTask({
    required this.action,
    this.params = const <String, dynamic>{},
    this.scope = 'device',
  });

  @override
  String toString() => 'StelarithTask($action, params=$params)';
}

/// 解析结果：要么是一条任务，要么只是一段通知正文。
class TaskExtraction {
  final StelarithTask? task;
  final String notice;
  const TaskExtraction({this.task, this.notice = ''});
  bool get hasTask => task != null;
}

/// 动作执行结果。[detail] 必须能被人看懂 —— 它会进日志、进面板提示。
class ActionResult {
  final bool ok;
  final String detail;
  const ActionResult(this.ok, this.detail);
  static ActionResult yes(String d) => ActionResult(true, d);
  static ActionResult no(String d) => ActionResult(false, d);
}

/// 被控运行快照（UI 订阅它来显示状态）。
@immutable
class AgentStatus {
  final bool enabled;
  final String uid;
  /// 一句人能看懂的状态话
  final String phase;
  /// 最近一次轮询/上报是否成功（绿灯/红灯）
  final bool live;
  final DateTime? lastPollAt;
  final DateTime? lastReportAt;
  final int handled;
  final int failed;
  /// 最近一条执行的指令（人话）
  final String lastAction;
  final String lastError;
  /// 最近一张截图的路径（面板/本机可见）
  final String lastShot;

  const AgentStatus({
    this.enabled = false,
    this.uid = '',
    this.phase = '未开启',
    this.live = false,
    this.lastPollAt,
    this.lastReportAt,
    this.handled = 0,
    this.failed = 0,
    this.lastAction = '',
    this.lastError = '',
    this.lastShot = '',
  });

  AgentStatus copyWith({
    bool? enabled,
    String? uid,
    String? phase,
    bool? live,
    DateTime? lastPollAt,
    DateTime? lastReportAt,
    int? handled,
    int? failed,
    String? lastAction,
    String? lastError,
    String? lastShot,
  }) =>
      AgentStatus(
        enabled: enabled ?? this.enabled,
        uid: uid ?? this.uid,
        phase: phase ?? this.phase,
        live: live ?? this.live,
        lastPollAt: lastPollAt ?? this.lastPollAt,
        lastReportAt: lastReportAt ?? this.lastReportAt,
        handled: handled ?? this.handled,
        failed: failed ?? this.failed,
        lastAction: lastAction ?? this.lastAction,
        lastError: lastError ?? this.lastError,
        lastShot: lastShot ?? this.lastShot,
      );
}

// ---------------------------------------------------------------------------
// 通知（弹给老师看的那一条）
// ---------------------------------------------------------------------------

/// 一次要弹到老师眼前的通知。
///
/// 为什么要做成对象而不是直接弹气泡：面板下发的通知**必须留痕**。
/// 老师正在投影、或者窗口在托盘里，弹一下就没了 = 等于没发。
/// 所以走"事件 → 界面"：界面负责显示 + 存历史，老师回头还能翻。
class AgentNotice {
  final String title;
  final String body;
  final DateTime at;

  /// 是否"必须让老师立刻看见"。
  ///
  /// 集控下发的通知 = 是（要把窗口从托盘叫回来、临时置顶）；
  /// 本机自己的确认（已截图等）= 否（只挂个横幅，不抢你的屏幕）。
  /// 所有通知都置顶会变成"这软件老弹出来"的反感源。
  final bool urgent;

  const AgentNotice({
    required this.title,
    required this.body,
    required this.at,
    this.urgent = true,
  });

  /// 界面上显示的主文本：标题和正文重复时只留一份。
  ///
  /// 面板广播常见是 title 和 body 都填了同一句话（甚至 MessageMask 与
  /// MessageContent 一模一样），直接拼两行会显得很蠢。
  String get display {
    final t = title.trim();
    final b = body.trim();
    if (t.isEmpty) return b;
    if (b.isEmpty || b == t) return t;
    if (b.startsWith(t)) return b;
    return '$t\n$b';
  }
}

// ---------------------------------------------------------------------------
// 引擎
// ---------------------------------------------------------------------------

class DeviceAgent {
  DeviceAgent({
    required Settings Function() readSettings,
    ScreenCapture? capture,
    http.Client? client,
    this.dryRun = false,
  })  : _read = readSettings,
        _capture = capture ?? ScreenShot.capture,
        _client = client ?? http.Client();

  final Settings Function() _read;
  final ScreenCapture _capture;
  final http.Client _client;

  /// 演练模式：**只用于自检/测试**，任何会改变本机的动作都直接拒绝执行。
  /// 有了它，`tool/selfcheck` 才能安全地跑一遍"这条指令我会怎么处理"，
  /// 而不会顺手把跑测试的人自己的机器关掉。
  final bool dryRun;

  /// 会改变本机的动作 —— 演练模式下必须拦下
  static const Set<String> dangerousActions = {
    'shutdown',
    'reboot',
    'lock',
    'set_volume',
    'screenshot',
  };

  /// 指令轮询间隔（对齐教室端插件的心跳节奏；面板下发后一般 4~8s 内生效）
  static const Duration pollEvery = Duration(seconds: 4);

  /// 状态上报间隔。后端 `FRESH_SECONDS = 90`，20s 上报 ⇒ 容忍两次丢包。
  static const Duration reportEvery = Duration(seconds: 20);

  /// 退避上限：宁可慢一点，也不能把本机 IP 打成 CCProtect 封禁
  static const int maxBackoffSeconds = 120;

  final ValueNotifier<AgentStatus> _status = ValueNotifier(const AgentStatus());
  ValueListenable<AgentStatus> get status => _status;
  AgentStatus get snapshot => _status.value;

  /// 最新一条要弹的通知（null = 当前没有）。界面监听它弹窗。
  final ValueNotifier<AgentNotice?> notice = ValueNotifier(null);

  /// 界面是否已接管弹窗。
  ///
  /// 有界面 → 弹窗由 Flutter 层负责（好看、可留痕、不闪黑框）；
  /// 没有界面（CLI 自检、或界面还没挂上）→ 才退回 PowerShell 气泡。
  /// 两条都发会变成"弹两次"，所以必须二选一。
  bool uiBound = false;

  int _noticeSeq = 0;

  Timer? _pollTimer;
  Timer? _reportTimer;
  int _pollBackoff = 0;
  int _reportBackoff = 0;
  bool _polling = false;
  bool _reporting = false;
  DateTime _startedAt = DateTime.now();

  // ---- 生命周期 ----

  void start() {
    if (_pollTimer != null) return;
    _startedAt = DateTime.now();
    _pollBackoff = 0;
    _reportBackoff = 0;
    Log.i('本机被控已启动（设备名 ${_read().deviceUid}）', 'agent');
    _armPoll(immediate: true);
    _armReport(immediate: true);
    _update(phase: '已开启');
  }

  void stop() {
    _pollTimer?.cancel();
    _reportTimer?.cancel();
    _pollTimer = null;
    _reportTimer = null;
    _polling = false;
    _reporting = false;
    Log.i('本机被控已停止（这台电脑不再接收下发指令）', 'agent');
    _update(live: false, phase: '未开启');
  }

  /// 设置变化后调用：按需起停。
  void sync() {
    final want = _read().agentEnabled;
    if (want && _pollTimer == null) start();
    if (!want && _pollTimer != null) stop();
    _update();
  }

  void dispose() {
    _disposed = true;
    stop();
    _client.close();
    _status.dispose();
  }

  /// 容器已释放（测试收尾 / 应用退出）。
  /// 必须挡住 —— 否则 dispose 链里再去 read provider 会抛
  /// "Tried to read a provider from a ProviderContainer that was already disposed"，
  /// 把一次正常退出变成一堆红字。
  bool _disposed = false;

  /// 为什么不能工作（null = 可以工作）。UI 直接拿这句显示，不让用户猜。
  String? get blockedReason {
    final s = _read();
    if (!s.agentEnabled) return null;
    if (s.demo) return '演示模式下不会真的连接教室';
    if (s.authMode != 'website') return '本机被控需要用网站账号登录（当前是直连模式）';
    if (s.siteHost.isEmpty) return '没有填网站地址，无法上报本机状态';
    if (s.token.isEmpty) return '未登录，无法接收下发指令';
    return null;
  }

  // ---- 轮询 ----

  void _armPoll({bool immediate = false}) {
    _pollTimer?.cancel();
    final delay = immediate
        ? Duration.zero
        : Duration(seconds: pollEvery.inSeconds + _pollBackoff);
    _pollTimer = Timer(delay, () async {
      await _pollOnce();
      if (_pollTimer != null) _armPoll();
    });
  }

  Future<void> _pollOnce() async {
    if (_polling) return;
    final s = _read();
    if (!s.agentEnabled) return;
    if (blockedReason != null) {
      _update(live: false, phase: blockedReason!);
      _pollBackoff = 30; // 没配好就别猛敲，30s 后再看
      return;
    }
    _polling = true;
    try {
      final path = '/api/console/cims/v1/client'
          '/${Uri.encodeComponent(s.deviceUid)}/command/queued';
      final res = await _send('GET', s.siteHost, path);
      if (res.statusCode >= 400) {
        _onHttpFailure('轮询', res);
        return;
      }
      _pollBackoff = 0;
      final body = _decode(res);
      final raw = body['commands'];
      final list = raw is List ? raw : const [];
      _update(
        live: true,
        phase: '在线 · 已连接',
        lastPollAt: DateTime.now(),
      );
      if (list.isEmpty) return;
      Log.i('取到 ${list.length} 条下发指令', 'agent');
      for (final e in list) {
        if (e is! Map) continue;
        await _handle(DeviceCommand.fromJson(Map<String, dynamic>.from(e)));
      }
    } catch (e) {
      _onTransportFailure('轮询', e);
    } finally {
      _polling = false;
    }
  }

  // ---- 指令执行 ----

  Future<void> _handle(DeviceCommand cmd) async {
    final parsed = extract(cmd.type, cmd.payload);
    final task = parsed.task;
    ActionResult result;
    if (task == null) {
      // 纯通知（面板「发通知」按钮、广播）：弹给老师看。
      final text = parsed.notice.trim();
      if (text.isEmpty) {
        result = ActionResult.no('收到一条既无动作也无正文的指令（type=${cmd.type}）');
      } else {
        // 解析出来是 `标题\n正文`（见 `_findNotice`：MessageMask 是标题）。
        // 只有一行时，那一行本身就是通知内容，别再硬塞一个"通知"当标题。
        final nl = text.indexOf('\n');
        final head = nl > 0 ? text.substring(0, nl).trim() : '集控通知';
        final rest = nl > 0 ? text.substring(nl + 1).trim() : text;
        result = await _notify(head, rest, urgent: true);
      }
    } else {
      result = await run(task);
    }
    _update(
      handled: result.ok ? snapshot.handled + 1 : snapshot.handled,
      failed: result.ok ? snapshot.failed : snapshot.failed + 1,
      lastAction: task == null
          ? '通知：${_clip(parsed.notice)}'
          : '${_label(task.action)}${result.ok ? " ✓" : " ✗"}',
      lastError: result.ok ? '' : result.detail,
    );
    await _ack(cmd.id, result.ok ? 'done' : 'failed', result.detail);
  }

  Future<void> _ack(int id, String status, String detail) async {
    final s = _read();
    if (id < 0) return;
    if (status == 'failed') {
      Log.e('指令 #$id 执行失败：$detail', 'agent');
    } else {
      Log.i('指令 #$id 已执行：$detail', 'agent');
    }
    try {
      final res = await _send(
        'POST',
        s.siteHost,
        '/api/console/cims/v1/client/${Uri.encodeComponent(s.deviceUid)}/command/ack',
        body: {'command_ids': [id], 'status': status},
      );
      if (res.statusCode >= 400) {
        Log.w('回报指令 #$id 失败（HTTP ${res.statusCode}）：面板会一直显示"待回执"', 'agent');
      }
    } catch (e) {
      Log.w('回报指令 #$id 失败：$e', 'agent');
    }
  }

  /// 执行一条本机动作。**公开**：设置页的「试一下」按钮与 CLI 自检都用它。
  Future<ActionResult> run(StelarithTask task, {String? shotPath}) async {
    if (dryRun && dangerousActions.contains(task.action)) {
      return ActionResult.no(
          '演练模式：不执行 ${task.action}（本机不会有任何变化）');
    }
    final p = task.params;
    switch (task.action) {
      case 'shutdown':
        return _runProcess('shutdown', ['/s', '/t', '${_intOr(p['delay'], 0)}'],
            '已发起关机');
      case 'reboot':
        return _runProcess('shutdown', ['/r', '/t', '${_intOr(p['delay'], 0)}'],
            '已发起重启');
      case 'lock':
        return _runProcess(
            'rundll32.exe', ['user32.dll,LockWorkStation'], '已锁屏');
      case 'set_volume':
        return _setVolume(
          _intOr(p['value'] ?? p['volume'], 50),
          p['muted'] == true || p['muted'] == 1 || p['muted'] == '1',
        );
      case 'screenshot':
        return _screenshot(shotPath);
      case 'ping':
        return ActionResult.yes('心跳');
      default:
        return ActionResult.no('本机不支持的动作：${task.action}');
    }
  }

  Future<ActionResult> _runProcess(
      String exe, List<String> args, String okText) async {
    try {
      final r = await Process.run(exe, args).timeout(const Duration(seconds: 10));
      if (r.exitCode != 0) {
        final msg = '${r.stderr}'.trim();
        return ActionResult.no(
            '$okText失败（退出码 ${r.exitCode}${msg.isEmpty ? '' : '：$msg'}）');
      }
      return ActionResult.yes(okText);
    } catch (e) {
      return ActionResult.no('$okText失败：$e');
    }
  }

  Future<ActionResult> _screenshot(String? shotPath) async {
    final out = shotPath ?? ScreenShot.newShotPath();
    final r = await _capture(out);
    if (!r.ok) return ActionResult.no(r.detail);
    _update(lastShot: r.path);
    Log.i('截图已保存：${r.path}（${r.detail}）', 'agent');
    // 截图回传（#T07.7 步骤 4）：配置了设备上报密钥才上传到网站 ext captures，
    // 面板/桌面端控制侧才能按 uid 取到这张图。失败不阻断本机落盘 ——
    // 截图先落盘是主结果，回传是加分项。
    final upload = await _uploadCapture(r.path);
    final uploaded = upload == null || upload.isEmpty;
    final suffix = upload == null
        ? ''
        : (uploaded ? '，已回传集控端' : '（回传失败：$upload）');
    await _notify('星集控 · 已截图', '保存到 ${r.path}$suffix');
    return ActionResult.yes('截图已保存：${r.path}$suffix');
  }

  /// 截图回传：POST `{site}/api/console/ext/captures`（设备密钥鉴权，
  /// 与教室端 Rust 代理同一通道，见网站 `src/routes/api/console/ext/[...path]/+server.ts`）。
  ///
  /// 返回：
  ///   · null  —— 未配置上报密钥（本机不启用回传，属预期行为）；
  ///   · ''    —— 上传成功；
  ///   · 其他  —— 人话错误摘要（只记日志/追加文案，绝不把整条截图动作判失败）。
  Future<String?> _uploadCapture(String path) async {
    final s = _read();
    final secret = s.deviceSecret.trim();
    if (secret.isEmpty) return null;
    try {
      final file = File(path);
      if (!await file.exists()) return '本地文件不存在';
      final bytes = await file.readAsBytes();
      final base = s.siteHost.endsWith('/')
          ? s.siteHost.substring(0, s.siteHost.length - 1)
          : s.siteHost;
      final uri = Uri.parse('$base/api/console/ext/captures');
      final req = http.Request('POST', uri);
      req.headers['Content-Type'] = 'application/json';
      req.headers['x-stelarith-device-secret'] = secret;
      req.body = jsonEncode({
        // uid 小写归一化：CIMS host 字段可能大写（N7-...），ext 层已统一 toLowerCase 匹配
        'uid': s.deviceUid.toLowerCase(),
        'image_base64': base64Encode(bytes),
      });
      final streamed = await _client
          .send(req)
          .timeout(const Duration(seconds: 15));
      final res = await http.Response.fromStream(streamed)
          .timeout(const Duration(seconds: 15));
      if (res.statusCode >= 400) {
        final why = _clip(
            utf8.decode(res.bodyBytes, allowMalformed: true).trim());
        Log.w('截图回传失败（HTTP ${res.statusCode}）：$why', 'agent');
        return 'HTTP ${res.statusCode}${why.isEmpty ? '' : ' $why'}';
      }
      final body = _decode(res);
      Log.i('截图已回传（uid=${s.deviceUid}，${body['bytes'] ?? bytes.length} bytes）', 'agent');
      return '';
    } catch (e) {
      Log.w('截图回传失败：$e', 'agent');
      return '$e';
    }
  }

  Future<ActionResult> _setVolume(int value, bool muted) async {
    final v = value.clamp(0, 100);
    final r = await _psScript(_volumeScript, ['-Volume', '$v', '-Muted', muted ? '1' : '0']);
    if (!r.ok) return ActionResult.no(r.detail);
    return ActionResult.yes('音量已设为 $v%${muted ? "（静音）" : ""}');
  }

  Future<ActionResult> _notify(String title, String body,
      {bool urgent = false}) async {
    // ① 界面在跑 → 交给界面弹（大字体、置顶、可留痕），**不**再起 PowerShell。
    //
    //    以前这里一律走 PowerShell 气泡，实测有两个硬伤：
    //    a) 会闪一个黑色控制台窗口 —— 老师第一反应是"中病毒了"；
    //    b) 气泡很小、几秒就消失，正文稍长就看不全。
    //    b 的真正成因是解析没取到 MessageMask，退化成拿 payload 原文（一坨 JSON），
    //    见 `_findNotice`；那个 bug 已修，但气泡本身的形态仍然不适合当"正式通知"。
    if (uiBound) {
      _noticeSeq++;
      notice.value = AgentNotice(
        title: title,
        body: body,
        at: DateTime.now(),
        urgent: urgent,
      );
      Log.i('已投递通知到界面（第 $_noticeSeq 条${urgent ? "" : "，非急"}）：${_clip(body)}',
          'agent');
      return ActionResult.yes('已在本机弹出通知');
    }

    // ② 没有界面（CLI 自检 / 界面未挂载）→ 退回 PowerShell 气泡，聊胜于无。
    // 标题/正文都是中文，走**临时 JSON 文件**传给脚本 ——
    // PS 5.1 的 `-File` 参数在非 ASCII 下会被按 ANSI 解释而乱码。
    File? cfg;
    try {
      cfg = File('${Directory.systemTemp.path}'
          '${Platform.pathSeparator}xjk-notice-${DateTime.now().microsecondsSinceEpoch}.json');
      await cfg.writeAsString(jsonEncode({'title': title, 'body': body}),
          flush: true, encoding: utf8);
      final r = await _psScript(_noticeScript, ['-Config', cfg.path]);
      if (!r.ok) {
        Log.w('桌面提示未弹出：${r.detail}', 'agent');
        return ActionResult.yes('通知已记录（桌面提示不可用：${r.detail}）');
      }
      return ActionResult.yes('已弹出桌面通知');
    } catch (e) {
      return ActionResult.yes('通知已记录（$e）');
    } finally {
      try {
        if (cfg != null && await cfg.exists()) await cfg.delete();
      } catch (_) {}
    }
  }

  Future<ActionResult> _psScript(String script, List<String> args) async {
    File? f;
    try {
      f = File('${Directory.systemTemp.path}'
          '${Platform.pathSeparator}xjk-${DateTime.now().microsecondsSinceEpoch}.ps1');
      // 脚本内容保持纯 ASCII；可变内容一律走参数/外部文件。
      await f.writeAsString(script, flush: true, encoding: const SystemEncoding());
      final r = await Process.run(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', f.path, ...args],
      ).timeout(const Duration(seconds: 20));
      final out = '${r.stdout}'.trim();
      final err = '${r.stderr}'.trim();
      if (r.exitCode != 0 || !out.contains('OK')) {
        final why = out.isEmpty ? err : out;
        return ActionResult.no(why.isEmpty ? '脚本退出码 ${r.exitCode}' : why);
      }
      return ActionResult.yes(out);
    } catch (e) {
      return ActionResult.no('$e');
    } finally {
      try {
        if (f != null && await f.exists()) await f.delete();
      } catch (_) {}
    }
  }

  // ---- 状态上报 ----

  void _armReport({bool immediate = false}) {
    _reportTimer?.cancel();
    final delay = immediate
        ? const Duration(seconds: 3)
        : Duration(seconds: reportEvery.inSeconds + _reportBackoff);
    _reportTimer = Timer(delay, () async {
      await reportNow();
      if (_reportTimer != null) _armReport();
    });
  }

  /// 立即上报一次（设置页「立即上报」按钮也用它）。
  Future<ActionResult> reportNow() async {
    if (_reporting) return ActionResult.no('正在上报中');
    final s = _read();
    if (!s.agentEnabled) return ActionResult.no('未开启本机被控');
    final blocked = blockedReason;
    if (blocked != null) {
      _update(live: false, phase: blocked);
      return ActionResult.no(blocked);
    }
    _reporting = true;
    try {
      final res = await _send(
        'POST',
        s.siteHost,
        '/api/console/cims/v1/client/${Uri.encodeComponent(s.deviceUid)}/status',
        body: _statusBody(),
      );
      if (res.statusCode >= 400) {
        _onHttpFailure('上报', res);
        return ActionResult.no('HTTP ${res.statusCode}');
      }
      _reportBackoff = 0;
      _update(
        live: true,
        phase: '在线 · 已连接',
        lastReportAt: DateTime.now(),
      );
      Log.i('状态已上报（设备名 ${s.deviceUid}）', 'agent');
      return ActionResult.yes('已上报');
    } catch (e) {
      _onTransportFailure('上报', e);
      return ActionResult.no('$e');
    } finally {
      _reporting = false;
    }
  }

  /// 心跳体。字段名对齐教室端插件 + 后端 `status.py` 的兜底读取顺序：
  /// 操作系统名放**顶层 `os_name`**（后端首选），`extra.os` 是旧路径只作兜底。
  ///
  /// 改名（票 #246）只改 `host` / `display_name` 这两个展示字段，绑定键 `client_uid`
  /// 仍是固化不变的 [Settings.deviceUid]，因此后端按 uid 更新同一台设备的展示名，
  /// 不会新建记录。
  Map<String, dynamic> _statusBody() {
    final s = _read();
    final up = DateTime.now().difference(_startedAt).inSeconds;
    // 展示名：用户改过的“设备名”，没有则用固化身份键兜底（绝不为空）。
    final display = s.deviceName.trim().isNotEmpty ? s.deviceName : s.deviceUid;
    return {
      'host': display,
      'display_name': display,
      'version': 'xingjikong-desktop/1.0.0',
      'os_name': Platform.isWindows ? 'Windows' : Platform.operatingSystem,
      'class_id': s.classId,
      'active_class_group': '',
      'modules': const <String, dynamic>{},
      'plugins': const <dynamic>[],
      'extra': {
        'client_uid': s.deviceUid,
        'agent': 'xingjikong-desktop',
        'agent_enabled': true,
        'tray': true,
        'uptime_seconds': up,
        'process_id': pid,
        'is_64bit': !Platform.isWindows ? true : _is64Bit(),
        'os': Platform.operatingSystemVersion,
        'last_poll_at': snapshot.lastPollAt?.toIso8601String() ?? '',
        'handled': snapshot.handled,
        'failed': snapshot.failed,
        'last_shot': snapshot.lastShot,
      },
    };
  }

  static bool _is64Bit() =>
      Platform.version.contains('x64') || Platform.version.contains('arm64');

  // ---- 网络底层 ----

  Future<http.Response> _send(String method, String host, String path,
      {Object? body}) async {
    final base = host.endsWith('/') ? host.substring(0, host.length - 1) : host;
    final uri = Uri.parse('$base$path');
    final req = http.Request(method, uri);
    req.headers['Content-Type'] = 'application/json';
    final token = _read().token;
    if (token.isNotEmpty) req.headers['Authorization'] = 'Bearer $token';
    if (body != null) req.body = jsonEncode(body);
    final streamed = await _client
        .send(req)
        .timeout(const Duration(seconds: 8));
    return http.Response.fromStream(streamed)
        .timeout(const Duration(seconds: 8));
  }

  Map<String, dynamic> _decode(http.Response res) {
    if (res.bodyBytes.isEmpty) return <String, dynamic>{};
    try {
      final v = jsonDecode(utf8.decode(res.bodyBytes));
      return v is Map<String, dynamic> ? v : <String, dynamic>{};
    } catch (_) {
      return <String, dynamic>{};
    }
  }

  void _onHttpFailure(String what, http.Response res) {
    _bumpBackoff();
    final msg = 'HTTP ${res.statusCode}';
    final hint = switch (res.statusCode) {
      401 => '登录已失效，请重新登录',
      403 => '当前账号没有"本机被控"权限（需要设备控制权限）',
      502 => '网站连不上集控服务（后端可能没起来）',
      _ => _clip(utf8.decode(res.bodyBytes, allowMalformed: true)),
    };
    _update(live: false, phase: '$what失败：$hint', lastError: '$msg $hint');
    Log.e('$what失败：$msg $hint', 'agent');
  }

  void _onTransportFailure(String what, Object e) {
    _bumpBackoff();
    _update(live: false, phase: '$what失败：连不上站点', lastError: '$e');
    Log.e('$what失败：$e', 'agent');
  }

  void _bumpBackoff() {
    final cur = _pollBackoff == 0 ? pollEvery.inSeconds : _pollBackoff;
    _pollBackoff = (cur * 2).clamp(0, maxBackoffSeconds);
    final curR = _reportBackoff == 0 ? 0 : _reportBackoff;
    _reportBackoff = (curR == 0 ? 40 : curR * 2).clamp(0, maxBackoffSeconds);
  }

  void _update({
    bool? enabled,
    String? phase,
    bool? live,
    DateTime? lastPollAt,
    DateTime? lastReportAt,
    int? handled,
    int? failed,
    String? lastAction,
    String? lastError,
    String? lastShot,
  }) {
    if (_disposed) return;
    try {
      _status.value = _status.value.copyWith(
        enabled: enabled ?? _read().agentEnabled,
        uid: _read().deviceUid,
        phase: phase,
        live: live,
        lastPollAt: lastPollAt,
        lastReportAt: lastReportAt,
        handled: handled,
        failed: failed,
        lastAction: lastAction,
        lastError: lastError,
        lastShot: lastShot,
      );
    } catch (_) {
      // 设置容器已不可读（退出流程中）→ 状态无人看，丢掉即可，不要因此炸掉退出
    }
  }

  static int _intOr(dynamic v, int fallback) {
    if (v is num) return v.toInt();
    if (v is String) return int.tryParse(v) ?? fallback;
    return fallback;
  }

  static String _clip(String s, [int n = 60]) =>
      s.length <= n ? s : '${s.substring(0, n)}…';

  static String _label(String action) => switch (action) {
        'shutdown' => '关机',
        'reboot' => '重启',
        'lock' => '锁屏',
        'set_volume' => '调音量',
        'screenshot' => '截屏',
        'ping' => '心跳',
        _ => action,
      };

  // -------------------------------------------------------------------------
  // stelarith_task 解析（纯函数，可单测）
  // -------------------------------------------------------------------------

  /// 从命令的 `type`/`payload` 里抠出 `stelarith_task`。
  ///
  /// 与教室端插件 `StelarithCommandHandler.ExtractTask` 同源：payload 是 JSON，
  /// `stelarith_task` 可能在 payload 顶层，也可能被塞进 `MessageContent` 这个
  /// **字符串字段**里（再解一层 JSON）—— 面板下发时就是后者。
  static TaskExtraction extract(String type, String payload) {
    final decoded = _tryDecode(payload);
    final task = _findTask(decoded);
    if (task != null) return TaskExtraction(task: task);
    // 解析不出动作 → 当通知处理（面板「发通知」/ 广播走的就是这条）
    final notice = _findNotice(decoded) ?? payload.trim();
    return TaskExtraction(notice: notice);
  }

  static dynamic _tryDecode(String raw) {
    final t = raw.trim();
    if (t.isEmpty) return null;
    if (t[0] != '{' && t[0] != '[') return raw;
    try {
      return jsonDecode(t);
    } catch (_) {
      return raw;
    }
  }

  static StelarithTask? _findTask(dynamic node, [int depth = 0]) {
    if (node == null || depth > 4) return null;
    if (node is String) {
      final t = node.trim();
      if (t.isEmpty || (t[0] != '{' && t[0] != '[')) return null;
      return _findTask(_tryDecode(t), depth + 1);
    }
    if (node is List) {
      for (final e in node) {
        final r = _findTask(e, depth + 1);
        if (r != null) return r;
      }
      return null;
    }
    if (node is Map) {
      final raw = node['stelarith_task'];
      if (raw != null) {
        final t = raw is Map ? raw : _findTask(raw, depth + 1);
        if (t is Map) {
          final action = (t['action'] ?? '').toString();
          if (action.isNotEmpty) {
            final p = t['params'];
            return StelarithTask(
              action: action,
              params: p is Map ? Map<String, dynamic>.from(p) : const {},
              scope: (t['scope'] ?? 'device').toString(),
            );
          }
        }
      }
      for (final k in const [
        'MessageContent',
        'message_content',
        'content',
        'body',
        'data',
      ]) {
        final r = _findTask(node[k], depth + 1);
        if (r != null) return r;
      }
    }
    return null;
  }

  static String? _findNotice(dynamic node, [int depth = 0]) {
    if (node == null || depth > 4) return null;
    if (node is String) {
      final t = node.trim();
      if (t.isEmpty) return null;
      if (t[0] == '{' || t[0] == '[') return _findNotice(_tryDecode(t), depth + 1) ?? t;
      return t;
    }
    if (node is List) {
      for (final e in node) {
        final r = _findNotice(e, depth + 1);
        if (r != null) return r;
      }
      return null;
    }
    if (node is Map) {
      // 官方 SendNotification 信封：MessageMask 是**标题**，MessageContent 是正文。
      // 之前只找 content 系字段，而面板广播/通知带的就是这张信封、且 MessageContent
      // 常是空串 → 取不到 → 退回 payload 原文 → 桌面弹窗里显示的是一坨 JSON。
      // 所以这里必须**优先**取 MessageMask，而不是把它当成"又一个候选字段"。
      final mask = node['MessageMask'];
      if (mask is String && mask.trim().isNotEmpty) {
        final body = node['MessageContent'];
        if (body is String && body.trim().isNotEmpty) {
          return '${mask.trim()}\n${body.trim()}';
        }
        return mask.trim();
      }
      for (final k in const [
        'MessageContent',
        'message_content',
        'content',
        'title',
        'text',
        'body',
      ]) {
        final v = node[k];
        if (v is String && v.trim().isNotEmpty) return v.trim();
      }
      // 再往里挖一层：后端/面板可能把通知包在自定义信封里（如 `{'data': {...}}`）。
      // 不做这层递归的后果和上面一样 —— 弹出来的是 JSON 原文。
      for (final v in node.values) {
        if (v is String || v is Map || v is List) {
          final r = _findNotice(v, depth + 1);
          if (r != null) return r;
        }
      }
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // 内联脚本（纯 ASCII —— PS 5.1 对无 BOM 的 UTF-8 中文会按 ANSI 解析而崩）
  // -------------------------------------------------------------------------

  static const String _volumeScript = r'''
param([int]$Volume = 50, [int]$Muted = 0)
$ErrorActionPreference = 'Stop'
$src = @'
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr p);
  int UnregisterControlChangeNotify(IntPtr p);
  int GetChannelCount(out int pnChannelCount);
  int SetMasterVolumeLevel(float fLevelDB, Guid pguidEventContext);
  int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
  int GetMasterVolumeLevel(out float pfLevelDB);
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int SetChannelVolumeLevel(uint nChannel, float fLevelDB, Guid pguidEventContext);
  int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, Guid pguidEventContext);
  int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
  int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
  int GetMute(out bool pbMute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid id, int clsCtx, IntPtr act, [MarshalAs(UnmanagedType.IUnknown)] out object i);
}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int NotImpl1();
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorComObject { }
public class Audio {
  static IAudioEndpointVolume Vol() {
    IMMDeviceEnumerator en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
    IMMDevice dev;
    en.GetDefaultAudioEndpoint(0, 1, out dev);
    Guid iid = typeof(IAudioEndpointVolume).GUID;
    object o;
    dev.Activate(ref iid, 23, IntPtr.Zero, out o);
    return (IAudioEndpointVolume)o;
  }
  public static float GetVolume() { float v; Vol().GetMasterVolumeLevelScalar(out v); return v; }
  public static void SetVolume(float level) { Vol().SetMasterVolumeLevelScalar(level, Guid.Empty); }
  public static void SetMute(bool mute) { Vol().SetMute(mute, Guid.Empty); }
}
'@
try {
  Add-Type -TypeDefinition $src -Language CSharp
  if ($Volume -ge 0) { [Audio]::SetVolume([float]($Volume / 100.0)) }
  if ($Muted -ge 0) { [Audio]::SetMute([bool]($Muted -eq 1)) }
  Write-Output ("OK vol=" + [math]::Round(([Audio]::GetVolume()) * 100))
} catch {
  Write-Output ("ERR " + $_.Exception.Message)
  exit 1
}
''';

  static const String _noticeScript = r'''
param([Parameter(Mandatory=$true)][string]$Config)
$ErrorActionPreference = 'Stop'
try {
  $cfg = Get-Content -Path $Config -Raw -Encoding UTF8 | ConvertFrom-Json
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $ni = New-Object System.Windows.Forms.NotifyIcon
  $ni.Icon = [System.Drawing.SystemIcons]::Information
  $ni.BalloonTipTitle = [string]$cfg.title
  $ni.BalloonTipText = [string]$cfg.body
  $ni.Visible = $true
  $ni.ShowBalloonTip(10000)
  Start-Sleep -Seconds 11
  $ni.Visible = $false
  $ni.Dispose()
  Write-Output "OK"
} catch {
  Write-Output ("ERR " + $_.Exception.Message)
  exit 1
}
''';
}

/// 本机被控引擎（进程级单例）。
///
/// 刻意**不**用 autoDispose：它必须比任何页面活得久 —— 关窗进托盘之后仍在轮询。
/// 设置取 `settingsProvider.notifier` 的**实时快照**而不是 watch，
/// 否则每次改设置都会重建 Provider，轮询定时器被反复重启。
final deviceAgentProvider = Provider<DeviceAgent>((ref) {
  final agent = DeviceAgent(
    readSettings: () => ref.read(settingsProvider.notifier).current,
  );
  ref.onDispose(agent.dispose);
  return agent;
});
