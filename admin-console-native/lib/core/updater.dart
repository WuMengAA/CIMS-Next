/// 星集控 · OTA 自更新引擎（下载 → 校验 → 解压 → 自替换）
///
/// 设计要点：
///  * 只负责"把新版文件落到本机并重启自己"，**不负责检测**——检测在 update_check.dart。
///  * 下载走流式（带进度），到手先 sha256 校验，**校验不过宁可失败也不覆盖**
///    （防损坏/被篡改的包把正在用的客户端搞崩 → fail-silent 红线）。
///  * Windows 下运行中的 exe 不能被自己覆盖 → 用"生成 updater.bat + 退出本进程"
///    的经典模式：bat 等主程序退出 → xcopy 覆盖 → 重新拉起 exe。
///  * [allowRelaunch] = false 时只做到"解压就绪"就停（dev / 单测用），
///    绝不真的替换正在跑的自己。
library;

import 'dart:async';
import 'dart:io';

import 'package:archive/archive.dart';
import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart' show kReleaseMode;
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;

import 'log.dart';
import 'update_check.dart';

/// 更新阶段（UI 用同一套枚举显示进度）。
enum UpdatePhase {
  idle,
  downloading,
  verifying,
  extracting,
  preparing,
  relaunching,
  done,
  error,
}

/// 进度快照（不可变，便于 Riverpod 订阅）。
class UpdateProgress {
  final UpdatePhase phase;
  /// 下载进度 0..1；非下载阶段为 null。
  final double? fraction;
  final String message;
  final Object? error;
  /// 解压就绪后的临时目录（仅 dev/测试态非空；发布态进入重启后该目录会被 updater 用掉）。
  final String? stagingDir;
  const UpdateProgress({
    this.phase = UpdatePhase.idle,
    this.fraction,
    this.message = '',
    this.error,
    this.stagingDir,
  });

  UpdateProgress copyWith({
    UpdatePhase? phase,
    double? fraction,
    String? message,
    Object? error,
    String? stagingDir,
  }) =>
      UpdateProgress(
        phase: phase ?? this.phase,
        fraction: fraction ?? this.fraction,
        message: message ?? this.message,
        error: error ?? this.error,
        stagingDir: stagingDir ?? this.stagingDir,
      );

  bool get isTerminal =>
      phase == UpdatePhase.done || phase == UpdatePhase.error;
}

/// 执行一次完整更新：下载 [version.url] 指向的 zip，校验 sha256，解压到临时 staging，
/// 然后（[allowRelaunch] 为真时）生成 updater 并重启自己。
///
/// [installDir] 应为当前 exe 所在目录；默认取 `Platform.resolvedExecutable` 的父目录。
/// [client] 仅供测试注入打桩。
/// [onProgress] 每阶段/每下载块回调一次。
///
/// ⚠️ 发布版里 [allowRelaunch] 默认 = [kReleaseMode]：调试构建只验证到解压层，
/// 不会覆盖开发机上的自己（防自爆）。
Future<void> performUpdate(
  AppVersion version, {
  String? installDir,
  http.Client? client,
  bool? allowRelaunch,
  void Function(UpdateProgress)? onProgress,
}) async {
  final c = client ?? http.Client();
  final bool relaunch = allowRelaunch ?? kReleaseMode;
  final tmp = await Directory.systemTemp.createTemp('xingjikong-update-');
  try {
    if (version.url.isEmpty) {
      throw StateError('更新包地址为空，无法下载（服务端未提供 url）');
    }

    onProgress?.call(const UpdateProgress(
        phase: UpdatePhase.downloading, message: '正在下载更新包…'));

    final zipPath = p.join(tmp.path, 'release.zip');
    final staging = Directory(p.join(tmp.path, 'staging'));
    await staging.create(recursive: true);

    final req = http.Request('GET', Uri.parse(version.url));
    final streamed = await c.send(req).timeout(const Duration(seconds: 30));
    if (streamed.statusCode != 200) {
      throw StateError('下载失败：HTTP ${streamed.statusCode}');
    }
    final total = streamed.contentLength ?? -1;
    final sink = File(zipPath).openWrite();
    var received = 0;
    await for (final chunk in streamed.stream) {
      sink.add(chunk);
      received += chunk.length;
      if (total > 0) {
        onProgress?.call(UpdateProgress(
          phase: UpdatePhase.downloading,
          fraction: received / total,
          message:
              '下载中 ${(received / 1048576).toStringAsFixed(1)} / '
              '${(total / 1048576).toStringAsFixed(1)} MB',
        ));
      }
    }
    await sink.close();

    onProgress?.call(const UpdateProgress(
        phase: UpdatePhase.verifying, message: '校验完整性…'));
    if (version.sha256.isNotEmpty) {
      final actual =
          (await sha256.bind(File(zipPath).openRead()).first).toString();
      if (actual.toLowerCase() != version.sha256.toLowerCase()) {
        throw StateError('校验失败：文件损坏或被篡改（sha256 不匹配）');
      }
    }

    onProgress?.call(const UpdateProgress(
        phase: UpdatePhase.extracting, message: '解压更新文件…'));
    final bytes = await File(zipPath).readAsBytes();
    final archive = ZipDecoder().decodeBytes(bytes);
    for (final f in archive) {
      final outPath = p.join(staging.path, f.name);
      if (f.isFile) {
        await File(outPath).create(recursive: true);
        await File(outPath).writeAsBytes(f.content as List<int>);
      } else {
        await Directory(outPath).create(recursive: true);
      }
    }

    onProgress?.call(UpdateProgress(
        phase: UpdatePhase.preparing,
        stagingDir: staging.path,
        message: '准备更新…'));

    if (!relaunch) {
      // dev / 单测：到此为止，staging 留在 tmp 供断言检查。
      onProgress?.call(UpdateProgress(
          phase: UpdatePhase.done,
          stagingDir: staging.path,
          message: '已就绪（开发模式未自动重启）'));
      return;
    }

    final dir = installDir ??
        Directory(Platform.resolvedExecutable).parent.path;
    await _relaunchWithUpdatedFiles(staging.path, dir);
    // _relaunchWithUpdatedFiles 成功即 exit，正常不会回到这里。
  } catch (e, st) {
    Log.e('更新失败：$e\n$st', 'update');
    onProgress?.call(UpdateProgress(
        phase: UpdatePhase.error, message: '更新失败：$e', error: e));
    // 失败时清理临时目录（成功路径下文件会被 updater 用掉，不在此删除）。
    try {
      if (await tmp.exists()) await tmp.delete(recursive: true);
    } catch (_) {}
    rethrow;
  } finally {
    if (client == null) {
      c.close();
    }
  }
}

/// 生成 updater.bat 并 detached 启动，然后退出本进程。
///
/// bat 逻辑（纯 ASCII，避免 BOM/编码坑）：
///   1. `timeout /t 3` 等主程序退出、释放文件句柄；
///   2. `xcopy /y /e /i` 把 staging 全部覆盖到安装目录；
///   3. `start` 重新拉起 exe；
///   4. 自删 bat。
Future<void> _relaunchWithUpdatedFiles(String stagingDir, String installDir) async {
  const exeName = 'xingjikong.exe';
  // 用 replaceAll 把反斜杠换成批处理安全的正斜杠（xcopy 两者都认）。
  final staging = stagingDir.replaceAll('\\', '/');
  final install = installDir.replaceAll('\\', '/');
  final bat = File(p.join(stagingDir, '.xingjikong-updater.bat'));
  final content = '''
@echo off
rem 星集控自更新：等待主程序退出后覆盖文件并重启
timeout /t 3 /nobreak >nul
xcopy /y /e /i "$staging/*" "$install" >nul
start "" "$install/$exeName"
del "%~f0"
''';
  await bat.writeAsString(content, flush: true);

  Log.i('启动自更新：staging=$staging → install=$install', 'update');
  await Process.start('cmd.exe', ['/c', bat.path],
      mode: ProcessStartMode.detached, runInShell: false);
  // 给 bat 一点时间进入 timeout，然后本进程退出，释放 exe 句柄。
  await Future.delayed(const Duration(milliseconds: 300));
  // 退出前把进度置为 relaunching，UI 显示"正在重启"。
  exit(0);
}
