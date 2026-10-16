/// 星集控 · 独立桌面集控端入口
library;

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'core/api_client.dart';
import 'core/device_agent.dart';
import 'core/log.dart';
import 'core/settings.dart';
import 'core/tray.dart';
import 'core/update_check.dart';
import 'features/history/history_window.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // 日志落盘：被控机器无人值守，出问题时只有这个文件能拿到现场
  FileLog.init();

  // 独立历史消息窗口入口：`xingjikong.exe --history` 启动为只读的
  // 悬浮历史侧栏（屏幕右侧独立窗口，可置顶/贴边/缩放），主窗口的「历史」抽屉
  // 用它拉起新实例。历史数据与本窗口同读本机 notice_history.json 文件，
  // 无需跨进程同步。
  final isHistoryWindow =
      Platform.executableArguments.any((a) => a.toLowerCase() == '--history');
  if (isHistoryWindow) {
    Log.i('===== 星集控独立历史窗口启动 =====', 'history');
    await runHistoryWindow();
    return;
  }

  Log.i('===== 星集控桌面端启动 =====', 'app');

  // 桌面外壳先建壳、后接容器：它自己要读容器里的设置与引擎，
  // 而容器又需要一个 override 才能建 —— 顺序必须这样绕。
  final shell = ShellController();
  final container = ProviderContainer(overrides: [
    shellProvider.overrideWithValue(shell),
  ]);
  shell.attach(container);

  await container.read(settingsProvider.notifier).load();
  // 首次启动自动探测本机 CIMS 后端并填入默认地址（开箱即用）
  await container.read(settingsProvider.notifier).detectLocalBackend();
  // 已用网站账号登录过 → 顺手刷新身份快照（角色可能被管理员改过；旧版本也没存过）。
  // 失败不影响启动：拿不到身份就按全量入口展示，绝不因此挡住界面。
  final s = container.read(settingsProvider);
  if (!s.demo && s.authMode == 'website' && s.token.isNotEmpty) {
    try {
      await container.read(apiProvider).fetchIdentity();
    } catch (_) {/* 身份是锦上添花，不阻断启动 */}
  }

  // 托盘 + 窗口 + 开机自启（必须在 runApp 之前 await，否则首帧会闪默认窗口）
  await shell.init();

  // 本机被控：登录态/开关一变就跟着起停（幂等，重复调用无副作用）
  final agent = container.read(deviceAgentProvider);
  agent.status.addListener(shell.onAgentStatusChanged);
  container.listen(settingsProvider, (prev, next) {
    agent.sync();
  });
  agent.sync();
  // 双端更新自检（票 #245）：启动即查一次，之后每 30 分钟轮一次。
  // 接口未部署时静默回落（日志里记一笔），不阻断启动。
  // 版本接口地址可配置（设置项 updateUrl > 编译期 dart-define > 登录站点 > 默认站点），
  // 客户端不写死域名。
  container
      .read(updateProvider.notifier)
      .start(siteHost: s.siteHost, updateUrl: s.updateUrl);
  Log.i('星集控桌面端已启动（设备名 ${container.read(settingsProvider).deviceUid}）', 'app');

  runApp(UncontrolledProviderScope(container: container, child: const XingjikongApp()));
}
