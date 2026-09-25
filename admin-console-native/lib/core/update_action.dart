/// 星集控 · 更新动作层（把"立即更新"按钮接到 OTA 引擎）
///
/// UI（首页横幅 / 设置页）只调 [UpdateActionNotifier.start(version)]，
/// 进度通过 [updateActionProvider] 暴露给界面显示；引擎层负责下载/校验/解压/重启。
library;

import 'dart:io';

import 'package:flutter/foundation.dart' show kReleaseMode;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'log.dart';
import 'update_check.dart';
import 'updater.dart';

final updateActionProvider =
    StateNotifierProvider<UpdateActionNotifier, UpdateProgress?>(
  (ref) => UpdateActionNotifier(),
);

class UpdateActionNotifier extends StateNotifier<UpdateProgress?> {
  UpdateActionNotifier() : super(null);

  bool get busy =>
      state != null &&
      state!.phase != UpdatePhase.done &&
      state!.phase != UpdatePhase.error;

  /// 触发一次完整更新。重复点击会被 [busy] 挡掉。
  ///
  /// [allowRelaunch] 默认跟 [kReleaseMode] 走：调试构建只验证到"解压就绪"，
  /// 不会真的覆盖开发机上的自己；发布版才执行替换+重启。
  Future<void> start(AppVersion version, {bool? allowRelaunch}) async {
    if (busy) return;
    if (version.url.isEmpty) {
      state = const UpdateProgress(
          phase: UpdatePhase.error, message: '服务端未提供更新包地址');
      return;
    }
    final installDir = Directory(Platform.resolvedExecutable).parent.path;
    state = const UpdateProgress(phase: UpdatePhase.idle, message: '准备更新…');
    try {
      await performUpdate(
        version,
        installDir: installDir,
        allowRelaunch: allowRelaunch ?? kReleaseMode,
        onProgress: (p) => state = p,
      );
      // 发布版里 performUpdate 成功即 exit，不会回到这里；
      // 走到这里说明是 dev 模式（只验证到解压层）。
      if (state?.phase != UpdatePhase.error) {
        state = state?.copyWith(
            message: state!.message.isEmpty
                ? '更新已就绪（开发模式未自动重启）'
                : '${state!.message}（开发模式未自动重启）');
      }
    } catch (e) {
      Log.e('更新动作失败：$e', 'update');
      // performUpdate 的 onProgress 已把 error 阶段写进 state；
      // 若因异常未写入（极少），这里兜底。
      state ??= UpdateProgress(phase: UpdatePhase.error, message: '更新失败：$e');
    }
  }
}
