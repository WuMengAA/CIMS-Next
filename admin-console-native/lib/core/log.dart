/// 星集控 · 运行时日志
///
/// 设计要点（调试入口的基础设施）：
/// 1. 进程内单例 + 环形缓冲（默认 800 条），release 模式同样记录——
///    排障时用户无需重新打 debug 包，调试面板里直接能看到最近的请求/异常。
/// 2. 实现 [ValueListenable]，UI 用 ValueListenableBuilder 订阅；
///    不继承 ChangeNotifier —— 避免 Riverpod/测试里 container.dispose()
///    把全局单例一起 dispose 掉，导致后续 add() 抛 "disposed"。
/// 3. 可导出为 .log 文本，便于把现场发给别人分析。
library;

import 'dart:io';

import 'package:flutter/foundation.dart';

enum LogLevel { info, warn, error, api }

class LogEntry {
  final DateTime at;
  final LogLevel level;
  final String tag;
  final String message;

  const LogEntry({
    required this.at,
    required this.level,
    required this.tag,
    required this.message,
  });

  String get clock {
    String two(int v) => v.toString().padLeft(2, '0');
    return '${two(at.hour)}:${two(at.minute)}:${two(at.second)}';
  }

  String format() =>
      '[$clock] ${level.name.toUpperCase().padRight(5)} $tag | $message';
}

class LogStore implements ValueListenable<List<LogEntry>> {
  LogStore._();

  static final LogStore instance = LogStore._();

  /// 缓冲容量
  static const int capacity = 800;

  /// 单元测试里关掉控制台输出（缓冲照常工作），避免刷屏淹没失败信息
  static bool muteConsole = false;

  final List<LogEntry> _items = <LogEntry>[];
  List<LogEntry> _snapshot = const <LogEntry>[];
  final List<VoidCallback> _listeners = <VoidCallback>[];

  @override
  List<LogEntry> get value => _snapshot;

  @override
  void addListener(VoidCallback listener) => _listeners.add(listener);

  @override
  void removeListener(VoidCallback listener) => _listeners.remove(listener);

  void add(LogLevel level, String tag, String message) {
    final entry = LogEntry(
        at: DateTime.now(), level: level, tag: tag, message: message);
    _items.add(entry);
    if (_items.length > capacity) {
      _items.removeRange(0, _items.length - capacity);
    }
    _snapshot = List<LogEntry>.unmodifiable(_items);
    final line = entry.format();
    // 控制台同步输出一份（flutter run / 终端启动 exe 时可见）
    if (!muteConsole) debugPrint(line);
    // 落盘一份（被控机器无人值守，出问题时只有这个文件能拿到现场）
    FileLog.write(line);
    for (final l in List<VoidCallback>.of(_listeners)) {
      l();
    }
  }

  void clear() {
    _items.clear();
    _snapshot = const <LogEntry>[];
    for (final l in List<VoidCallback>.of(_listeners)) {
      l();
    }
  }

  int get length => _items.length;

  /// 导出为纯文本（含全部缓冲条目）
  String dump() {
    final buf = StringBuffer()
      ..writeln('# 星集控运行日志')
      ..writeln('# 导出时间：${DateTime.now()}')
      ..writeln('# 平台：${Platform.operatingSystem} ${Platform.version}')
      ..writeln('# 条数：${_items.length}')
      ..writeln('');
    for (final e in _items) {
      buf.writeln(e.format());
    }
    return buf.toString();
  }

  /// 写入指定路径，返回是否成功
  Future<bool> exportTo(String path) async {
    try {
      final file = File(path);
      await file.parent.create(recursive: true);
      await file.writeAsString(dump(), flush: true);
      add(LogLevel.info, 'log', '日志已导出：$path（${_items.length} 条）');
      return true;
    } catch (e) {
      add(LogLevel.error, 'log', '导出失败：$e');
      return false;
    }
  }
}

/// 日志落盘。
///
/// 为什么必须有：星集控桌面端会被当成**被控设备**常驻在没人看着的机器上。
/// 出了问题（托盘没起来、指令执行失败、轮询被 403）时，
/// 用户能提供的只有"它没反应"——没有日志文件就等于没有现场。
///
/// 实现要点：
///   · 用 `IOSink` 异步追加，**绝不阻塞 UI 线程**（日志不能拖慢界面）；
///   · 按天切文件，启动时清理 7 天前的旧文件（不占满磁盘）；
///   · 写失败一律静默 —— 日志系统自己崩掉不该影响主流程。
class FileLog {
  static bool enabled = false;

  static IOSink? _sink;
  static String _day = '';
  static Directory? _dir;

  /// 日志目录：`%LOCALAPPDATA%\xingjikong\logs`
  static Directory dir() {
    _dir ??= Directory(
        '${Platform.environment['LOCALAPPDATA'] ?? Directory.systemTemp.path}'
        '${Platform.pathSeparator}xingjikong${Platform.pathSeparator}logs');
    return _dir!;
  }

  static void init() {
    if (enabled) return;
    enabled = true;
    try {
      _pruneOld();
      _open();
    } catch (_) {
      enabled = false;
    }
  }

  static String _dayOf(DateTime t) =>
      '${t.year}-${t.month.toString().padLeft(2, '0')}-${t.day.toString().padLeft(2, '0')}';

  static void _open() {
    final d = dir();
    if (!d.existsSync()) d.createSync(recursive: true);
    _day = _dayOf(DateTime.now());
    _sink = File('${d.path}${Platform.pathSeparator}xingjikong-$_day.log')
        .openWrite(mode: FileMode.append);
  }

  static void write(String line) {
    if (!enabled) return;
    try {
      final today = _dayOf(DateTime.now());
      if (today != _day) {
        _sink?.close();
        _open();
      }
      _sink?.writeln(line);
    } catch (_) {
      // 日志写不进去不影响任何业务
    }
  }

  static Future<void> close() async {
    try {
      await _sink?.flush();
      await _sink?.close();
    } catch (_) {}
    _sink = null;
  }

  static void _pruneOld() {
    try {
      final d = dir();
      if (!d.existsSync()) return;
      final cutoff = DateTime.now().subtract(const Duration(days: 7));
      for (final f in d.listSync()) {
        if (f is! File) continue;
        try {
          if (f.statSync().modified.isBefore(cutoff)) f.deleteSync();
        } catch (_) {}
      }
    } catch (_) {}
  }
}

/// 全局便捷入口：非 UI 代码（API 层、任务链路）可直接调用，无需 ref。
class Log {  static void i(String message, [String tag = 'app']) =>
      LogStore.instance.add(LogLevel.info, tag, message);

  static void w(String message, [String tag = 'app']) =>
      LogStore.instance.add(LogLevel.warn, tag, message);

  static void e(String message, [String tag = 'app']) =>
      LogStore.instance.add(LogLevel.error, tag, message);

  /// HTTP 请求/响应留痕（脱敏：不打印 Authorization）
  static void api(String message) =>
      LogStore.instance.add(LogLevel.api, 'api', message);
}
