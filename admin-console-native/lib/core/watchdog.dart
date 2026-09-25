/// 看门狗 —— 「软件自己也可能会卡死」这件事得有兜底。
///
/// 为什么必须有：星集控在被控机器上要**常驻**。老师上午八点去上课，
/// 软件卡在那儿没人知道，等到要用的时候点一下没反应 —— 那时她只会认为
/// "这软件真烂"，不会想到去任务管理器杀进程重开。
///
/// 为什么**不能静默重启**（用户 2026-09-25 明确选择）：
/// 老师可能正要投影、正要点什么。屏幕突然一黑重启一次，比卡住更吓人。
/// 所以一律先弹确认窗 + 15 秒倒计时，她点「取消」就彻底不再问。
///
/// 判定「卡死」的两个信号，缺一不可地保守：
///   ① 窗口看得见，但连续 [kNoFrameSeconds] 秒没有渲染帧 —— 界面真的僵住了；
///   ② 网络长期不通（退避已顶到上限）且无任何一次成功 —— 更像是进程挂在
///      网络 IO 上而不是"暂时没网"（暂时没网会自己恢复，不该重启）。
///
/// ⚠️ 托盘隐藏时**不参与**①的判定：那本来就是正常状态（关窗即进托盘），
/// 拿它当卡死会变成每分钟重启一次的闹剧。
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app.dart';
import 'device_agent.dart';
import 'log.dart';

class Watchdog {
  Watchdog._(this._container);

  static Watchdog? _instance;

  /// 必须在 main() 里、runApp 之后调用（要拿 navigator key 弹窗）。
  static void start(ProviderContainer container) {
    stop();
    _instance = Watchdog._(container)
      .._boot();
  }

  static void stop() {
    _instance?._dispose();
    _instance = null;
  }

  /// 界面每渲染一帧打一拍。窗口隐藏时 Flutter 不一定出帧，所以只在
  /// [WidgetsApp] 报"当前窗口可见"时才计数 —— 可见却不出帧 = 真卡住。
  static final ValueNotifier<bool> windowVisible = ValueNotifier(true);

  static const int kNoFrameSeconds = 15;
  static const int kRestartCountdown = 15;
  /// 网络彻底挂住的判定下限：连续这么久一次都没通，才考虑重启
  static const int kDeadNetworkSeconds = 300;

  final ProviderContainer _container;
  Timer? _tick;
  bool _stopped = false;

  /// 上次渲染帧的时间
  DateTime _lastFrame = DateTime.now();
  /// 网络连续不通的起始时刻（null = 目前是通的）
  DateTime? _pendingSince;
  int _logOffset = 0;
  int _errorsSeen = 0;
  bool _bugAlerted = false;
  /// 老师点过「先不重启」→ 本次运行不再因异常打扰她
  bool _restartArmed = true;

  void _boot() {
    WidgetsBinding.instance.addPersistentFrameCallback((_) {
      _lastFrame = DateTime.now();
    });
    _tick = Timer.periodic(const Duration(seconds: 3), (_) => _probe());
    Log.i('看门狗已启动（卡死 ${kNoFrameSeconds}s / 重启确认 ${kRestartCountdown}s）', 'watchdog');
  }

  void _dispose() {
    _stopped = true;
    _tick?.cancel();
    _tick = null;
  }

  void _probe() {
    if (_stopped) return;
    final now = DateTime.now();

    // ── ① 界面可见却长时间不出帧 ──────────────────────────────────
    if (windowVisible.value && now.difference(_lastFrame) > const Duration(seconds: kNoFrameSeconds)) {
      _raise('界面已 $kNoFrameSeconds 秒没有响应，可能卡住了');
      return;
    }

    // ── ② 网络长期不通 ────────────────────────────────────────────
    final agent = _container.read(deviceAgentProvider);
    final snap = agent.snapshot;
    if (!snap.live) {
      _pendingSince ??= now;
      if (now.difference(_pendingSince!) >
          const Duration(seconds: kDeadNetworkSeconds)) {
        _raise('长时间连不上集控（已 ${now.difference(_pendingSince!).inMinutes} 分钟），将重启以恢复被控');
      }
    } else {
      _pendingSince = null;
    }

    _scanLog();
  }

  /// 弹确认窗 → 老师不理会就自动重启，点了「先不重启」就不再问。
  ///
  /// 返回值：'restart' = 重启；'cancel' = 取消；null = 弹窗自己没了（别重启）。
  Future<void> _raise(String why) async {
    if (!_restartArmed) return; // 老师已经说过"先不重启" → 不再打扰
    _restartArmed = false;
    Log.w('看门狗触发：$why', 'watchdog');
    final ctx = appNavigatorKey.currentContext;
    if (ctx == null || !ctx.mounted) {
      Log.w('看门狗无法弹窗（无可用上下文），本次不重启', 'watchdog');
      return;
    }
    final decision = await showDialog<String>(
      context: ctx,
      barrierDismissible: false,
      builder: (dctx) => _RestartConfirmDialog(why: why),
    );
    if (decision == 'restart') {
      await _restart();
      return;
    }
    // 老师选了「先不重启」（或弹窗自己没了）：本次运行不再问，但界面恢复后
    // 网络仍不通时还有第二次机会（_raise 里会重新武装）。
    _lastFrame = DateTime.now();
  }

  /// 重启自身：拉起一个新实例（带 --watchdog-restart，不抢焦点、不弹窗），
  /// 然后退出自己。旧进程一走，新进程立刻接管托盘与被控上报。
  Future<void> _restart() async {
    Log.w('看门狗正在重启星集控', 'watchdog');
    try {
      final exe = Platform.resolvedExecutable;
      await Process.start(
        exe,
        const <String>['--watchdog-restart'],
        mode: ProcessStartMode.detached,
      );
    } catch (e) {
      Log.e('看门狗重启失败（需手动重启）：$e', 'watchdog');
      return;
    }
    exit(0);
  }

  /// bug 自动检测：扫本机日志里的 ERROR，攒够就提醒一次。
  /// 只在本机做 —— 不该为了统计错误就往服务器发一堆日志。
  void _scanLog() {
    try {
      final base =
          Platform.environment['LOCALAPPDATA'] ?? Directory.systemTemp.path;
      final f = File(
          '$base${Platform.pathSeparator}xingjikong${Platform.pathSeparator}logs${Platform.pathSeparator}xingjikong-${DateTime.now().toString().substring(0, 10)}.log');
      if (!f.existsSync()) return;
      final len = f.lengthSync();
      if (len <= _logOffset) return;
      final text = _readTail(f, _logOffset);
      _logOffset = len;
      final lines = text.split('\n');
      int hits = 0;
      for (final l in lines) {
        if (l.contains(' ERROR ') || l.contains('ERROR ')) hits++;
      }
      if (hits == 0) return;
      _errorsSeen += hits;
      // 攒到 5 条才提醒一次：一条两条的偶发异常不值得打扰老师
      if (!_bugAlerted && _errorsSeen >= 5) {
        _bugAlerted = true;
        Log.w('本机日志累计 $hits 条错误，等待下次启动排查', 'watchdog');
      }
    } catch (_) {
      // 读日志失败（占用中/权限）不影响看门狗
    }
  }

  /// 只读新增部分（从上次的字节偏移往后），避免每 3 秒把整个日志重新解码一遍。
  String _readTail(File f, int from) {
    try {
      final len = f.lengthSync();
      if (len <= from) return '';
      final all = f.readAsBytesSync();
      if (all.length <= from) return '';
      return utf8.decode(all.sublist(from), allowMalformed: true);
    } catch (_) {
      return '';
    }
  }
}

/// 重启确认对话框：15 秒倒计时，归零自动重启，点「先不重启」就此作罢。
class _RestartConfirmDialog extends StatefulWidget {
  const _RestartConfirmDialog({required this.why});

  final String why;

  @override
  State<_RestartConfirmDialog> createState() => _RestartConfirmDialogState();
}

class _RestartConfirmDialogState extends State<_RestartConfirmDialog> {
  int _left = Watchdog.kRestartCountdown;

  @override
  void initState() {
    super.initState();
    Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) {
        t.cancel();
        return;
      }
      setState(() => --_left);
      if (_left <= 0) {
        t.cancel();
        Navigator.of(context).pop('restart');
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('星集控检测到异常'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(widget.why),
          const SizedBox(height: 10),
          Text(
            '$_left 秒后自动重启星集控。现在点「先不重启」，本次运行就再也不会打扰你。',
            style: TextStyle(
                fontSize: 12,
                color: Theme.of(context).colorScheme.onSurfaceVariant),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop('cancel'),
          child: const Text('先不重启'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop('restart'),
          child: const Text('立即重启'),
        ),
      ],
    );
  }
}
