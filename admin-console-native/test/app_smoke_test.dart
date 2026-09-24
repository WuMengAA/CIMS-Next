/// 星集控 · UI 冒烟测试（不依赖真实后端）
///
/// 覆盖「人肉点界面才能发现」的问题：
///   * 未登录是否落在登录页、演示模式能否进主页
///   * 侧栏入口是否齐全
///   * 设置页「本机被控」卡片：开关是否按配置正确禁用、有没有说清原因
///   * 调试页自检在未配置后端时是否给出可操作提示
///
/// ⚠️ 断言一律对着**当前真实文案**写。以前这里是旧一代界面文案
/// （"设备管控"/"广播通知"/"后端连接"），改了界面却没人改测试，
/// 于是套件红着躺了很久 —— 红的测试比没有测试更糟。
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:xingjikong/app.dart';
import 'package:xingjikong/core/log.dart';
import 'package:xingjikong/core/settings.dart';
import 'package:xingjikong/core/tray.dart';
import 'package:xingjikong/features/debug/debug_page.dart';
import 'package:xingjikong/features/settings/settings_page.dart';

/// 建一个带 shellProvider override 的容器。
/// 必须 override —— `shellProvider` 故意在未 override 时抛错（它需要真实容器与窗口），
/// 设置页一渲染就会去读它。
ProviderContainer _container() {
  final shell = ShellController();
  final container = ProviderContainer(overrides: [
    shellProvider.overrideWithValue(shell),
  ]);
  shell.attach(container);
  return container;
}

Future<ProviderContainer> _boot(WidgetTester tester, {bool demo = false}) async {
  SharedPreferences.setMockInitialValues(<String, Object>{});
  final container = ProviderContainer(overrides: [
    shellProvider.overrideWithValue(ShellController()),
  ]);
  await container.read(settingsProvider.notifier).load();
  if (demo) {
    container.read(settingsProvider.notifier).setDemo(true);
  }
  // 桌面窗口给足宽度，否则 NavigationRail + 内容区会被判溢出并让测试失败
  tester.view.physicalSize = const Size(1600, 1000);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(() {
    tester.view.physicalSize = const Size(800, 600);
    container.dispose();
  });
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: const XingjikongApp(),
    ),
  );
  await tester.pumpAndSettle();
  return container;
}

/// 单独渲染某一页（不经过侧栏，避免"点导航"这类脆弱交互）
Future<ProviderContainer> _pumpPage(
  WidgetTester tester,
  Widget page, {
  bool demo = false,
}) async {
  SharedPreferences.setMockInitialValues(<String, Object>{});
  final container = _container();
  // 必须先 load 再改设置 —— setDemo 会写 prefs，未 load 时 _prefs 还没就绪
  await container.read(settingsProvider.notifier).load();
  if (demo) container.read(settingsProvider.notifier).setDemo(true);
  tester.view.physicalSize = const Size(1400, 1200);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(() {
    tester.view.physicalSize = const Size(800, 600);
    container.dispose();
  });
  await tester.pumpWidget(UncontrolledProviderScope(
    container: container,
    child: MaterialApp(home: Scaffold(body: page)),
  ));
  await tester.pumpAndSettle();
  return container;
}

void main() {
  LogStore.muteConsole = true;

  testWidgets('未登录 → 登录页', (tester) async {
    await _boot(tester);
    expect(find.text('星集控'), findsWidgets);
    expect(find.text('进入演示模式（不连后端）'), findsOneWidget);
  });

  testWidgets('演示模式 → 主页，侧栏入口齐全', (tester) async {
    await _boot(tester, demo: true);
    final rail = find.byType(NavigationRail);
    expect(rail, findsOneWidget);
    for (final label in [
      '教室设备',
      '发通知',
      '随机点名',
      '发文件',
      '调音量',
      '设置',
    ]) {
      expect(
        find.descendant(of: rail, matching: find.text(label)),
        findsWidgets,
        reason: '侧栏缺少入口：$label',
      );
    }
    // 顶栏必须说清"现在是演示模式"，否则用户会把示例数据当真实教室
    expect(find.text('演示模式'), findsWidgets);
  });

  testWidgets('设置页：本机被控在演示模式下不可开，并说清原因', (tester) async {
    await _pumpPage(tester, const SettingsPage(), demo: true);
    expect(find.text('本机被控（这台电脑）'), findsOneWidget);
    expect(find.text('演示模式下不会真的连接教室'), findsOneWidget);
    final sw = tester.widget<SwitchListTile>(
        find.widgetWithText(SwitchListTile, '允许被远程管理'));
    expect(sw.onChanged, isNull, reason: '条件不满足时不该让人打开一个假的开关');
  });

  testWidgets('设置页：直连 CIMS 模式同样不给开，原因是"要用网站账号登录"', (tester) async {
    // 默认 authMode = cims
    await _pumpPage(tester, const SettingsPage());
    expect(find.text('本机被控要用网站账号登录（当前是直连模式）'), findsOneWidget);
    final sw = tester.widget<SwitchListTile>(
        find.widgetWithText(SwitchListTile, '允许被远程管理'));
    expect(sw.onChanged, isNull);
  });

  testWidgets('调试页：未配置后端时自检给出可操作提示', (tester) async {
    await _pumpPage(tester, const DebugPage(), demo: true);
    expect(find.text('连接自检'), findsOneWidget);
    await tester.tap(find.text('运行自检'));
    await tester.pumpAndSettle();
    // 未配置管理端口时，自检应提示去设置页填 8097，而不是抛一个看不懂的异常
    expect(find.textContaining('8097'), findsWidgets);
  });
}
