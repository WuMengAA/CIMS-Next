/// 星集控 · 桌面外壳：任务栏托盘 + 关窗即隐藏 + 开机自启
///
/// 为什么星集控桌面端需要"常驻后台"：它在被当成**被控设备**用的那台机器上必须一直活着
/// —— 关掉窗口就等于这台电脑从集控里消失了，人走了就再也管不了（关机/重启/截屏都失效）。
/// 所以：
///   · 点关闭 = 收进托盘，不是退出；
///   · 托盘点一下 = 唤回主界面；
///   · 托盘菜单里能切「本机被控」、也能真退出；
///   · 开机自启由用户显式打开（默认关 —— 未经允许写启动项是不礼貌的）。
///
/// ⚠️ 托盘图标是**运行时按路径加载**的（不经过 Windows 资源编译器），
/// 所以 `assets/app_icon.ico` 必须留在 pubspec 的 assets 里，且不能改名。
library;

import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart' show Size;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:launch_at_startup/launch_at_startup.dart';
import 'package:tray_manager/tray_manager.dart';
import 'package:window_manager/window_manager.dart';

import 'device_agent.dart';
import 'log.dart';
import 'settings.dart';

/// 托盘图标资源路径（与 pubspec assets 一致）
const String kTrayIcon = 'assets/app_icon.ico';

/// 主窗口默认尺寸：够放下设备列表 + 侧栏
const Size kWindowSize = Size(1180, 760);

/// 桌面外壳单例。**必须在 `main()` 里 override** —— 它要拿到 ProviderContainer 本身，
/// 而 container 又要先有这个 override 才建得出来（先建壳、再 attach，绕开鸡生蛋）。
final shellProvider = Provider<ShellController>(
    (ref) => throw UnimplementedError('shellProvider 必须在 main() 里 override'));

class ShellController with TrayListener, WindowListener {
  ShellController();

  ProviderContainer? _box;
  ProviderContainer get _container => _box!;
  DeviceAgent get _agent => _container.read(deviceAgentProvider);
  SettingsNotifier get _settings => _container.read(settingsProvider.notifier);

  bool _ready = false;

  /// 把外壳接到 DI 容器上。必须在 [init] 之前调用。
  void attach(ProviderContainer container) => _box = container;

  /// 窗口/托盘/自启初始化。必须在 `runApp` **之前** await 完成 ——
  /// 否则首帧会先闪一下默认窗口再被重设尺寸。
  Future<void> init() async {
    if (!_isDesktop) {
      Log.w('当前平台不是 Windows，跳过托盘与窗口初始化', 'shell');
      return;
    }
    try {
      await windowManager.ensureInitialized();
      await windowManager.waitUntilReadyToShow(
        const WindowOptions(size: kWindowSize, center: true, title: '星集控'),
        () async {
          await windowManager.show();
          await windowManager.focus();
        },
      );
      // 关窗拦截：只有 registered listener 收到 onWindowClose 才能拦下来
      await windowManager.setPreventClose(true);
      windowManager.addListener(this);

      trayManager.addListener(this);
      await trayManager.setIcon(kTrayIcon);
      await _refreshMenu();
      _ready = true;
      Log.i('托盘已就绪：关窗不会退出，可从托盘唤回', 'shell');
    } catch (e) {
      // 托盘起不来不能挡住主流程：宁可"关窗即退出"，也要能用
      Log.e('托盘/窗口初始化失败（不影响主功能）：$e', 'shell');
    }
    await _applyStartup();
  }

  static bool get _isDesktop =>
      !kIsWeb && (Platform.isWindows || Platform.isLinux || Platform.isMacOS);

  // ---- 托盘菜单 ----

  Future<void> _refreshMenu() async {
    if (!_ready) return;
    final on = _container.read(settingsProvider).agentEnabled;
    final live = _agent.snapshot.live;
    try {
      await trayManager.setContextMenu(Menu(items: [
        MenuItem(key: 'show', label: '打开星集控'),
        MenuItem.separator(),
        MenuItem(key: 'agent', label: on ? '本机被控：已开启 ✓' : '本机被控：未开启'),
        MenuItem(key: 'report', label: '立即上报本机状态', disabled: !on || !live),
        MenuItem.separator(),
        MenuItem(key: 'exit', label: '退出星集控'),
      ]));
      await trayManager.setToolTip(
          on ? '星集控 · 本机被控中${live ? "" : "（未连接）"}' : '星集控 · 后台常驻');
    } catch (e) {
      Log.w('刷新托盘菜单失败：$e', 'shell');
    }
  }

  /// 状态变化时刷新托盘（被 DeviceAgent 的状态订阅调用）
  void onAgentStatusChanged() => _refreshMenu();

  @override
  void onTrayIconMouseDown() => showWindow();

  @override
  void onTrayIconRightMouseDown() async {
    // Windows 上右键菜单不会自动弹，必须显式 popUp
    await trayManager.popUpContextMenu();
  }

  @override
  void onTrayMenuItemClick(MenuItem menuItem) async {
    switch (menuItem.key) {
      case 'show':
        await showWindow();
        break;
      case 'agent':
        final next = !_container.read(settingsProvider).agentEnabled;
        _settings.setAgentEnabled(next);
        _agent.sync();
        await _refreshMenu();
        break;
      case 'report':
        final r = await _agent.reportNow();
        Log.i('手动上报：${r.ok ? "成功" : r.detail}', 'shell');
        await _refreshMenu();
        break;
      case 'exit':
        await exitApp();
        break;
    }
  }

  // ---- 窗口 ----

  @override
  void onWindowClose() async {
    // 关窗 = 进托盘。这是"常驻"的全部意义所在。
    await windowManager.hide();
    Log.i('窗口已收进托盘（仍在后台保持被控）', 'shell');
  }

  Future<void> showWindow() async {
    if (!_ready) return;
    await windowManager.show();
    await windowManager.focus();
  }

  /// 弹通知前把窗口**强行**摆到最前。
  ///
  /// 老师那台机器上，星集控多半正躺在托盘里（关窗即进托盘）。收到通知时
  /// 只 `show()` 是不够的 —— 窗口可能被别的程序盖住、或抢不到焦点，
  /// 结果就是"通知发了但没人看见"。所以这里额外临时置顶。
  Future<void> showForNotice() async {
    if (!_ready) return;
    try {
      await windowManager.show();
      await windowManager.setAlwaysOnTop(true);
      await windowManager.focus();
    } catch (e) {
      Log.w('弹窗前叫起窗口失败：$e', 'shell');
    }
  }

  /// 通知展示结束后必须撤销置顶 —— 否则窗口会一直压着别的程序，
  /// 老师会以为"这软件怎么关不掉"。
  Future<void> releaseNotice() async {
    if (!_ready) return;
    try {
      await windowManager.setAlwaysOnTop(false);
    } catch (_) {}
  }

  Future<void> exitApp() async {
    Log.i('用户从托盘退出星集控', 'shell');
    try {
      _agent.stop();
      await trayManager.destroy();
      // 必须先解除关窗拦截，否则 destroy 会被自己的 onWindowClose 拦成"隐藏"
      await windowManager.setPreventClose(false);
      await windowManager.destroy();
    } catch (e) {
      Log.w('退出时清理失败：$e', 'shell');
    }
    exit(0);
  }

  // ---- 开机自启 ----

  Future<void> _applyStartup() async {
    if (!Platform.isWindows) return;
    final want = _container.read(settingsProvider).startWithWindows;
    try {
      launchAtStartup.setup(
        appName: '星集控',
        appPath: Platform.resolvedExecutable,
      );
      final now = await launchAtStartup.isEnabled();
      if (want != now) {
        if (want) {
          await launchAtStartup.enable();
        } else {
          await launchAtStartup.disable();
        }
        Log.i(want ? '已设置开机自动启动' : '已取消开机自动启动', 'shell');
      }
    } catch (e) {
      Log.w('设置开机自启失败：$e', 'shell');
    }
  }

  /// 供设置页开关调用
  Future<bool> setStartWithWindows(bool v) async {
    _box?.read(settingsProvider.notifier).setStartWithWindows(v);
    if (!Platform.isWindows) return false;
    try {
      launchAtStartup.setup(
        appName: '星集控',
        appPath: Platform.resolvedExecutable,
      );
      if (v) {
        await launchAtStartup.enable();
      } else {
        await launchAtStartup.disable();
      }
      final ok = await launchAtStartup.isEnabled();
      Log.i(ok == v ? '开机自启 → $v' : '开机自启设置未生效（系统可能拒绝）', 'shell');
      return ok == v;
    } catch (e) {
      Log.w('设置开机自启失败：$e', 'shell');
      return false;
    }
  }

  Future<bool> readStartWithWindows() async {
    final fallback = _box?.read(settingsProvider).startWithWindows ?? false;
    if (!Platform.isWindows) return fallback;
    try {
      launchAtStartup.setup(
        appName: '星集控',
        appPath: Platform.resolvedExecutable,
      );
      return await launchAtStartup.isEnabled();
    } catch (_) {
      return fallback;
    }
  }

  void disposeListeners() {
    try {
      trayManager.removeListener(this);
      windowManager.removeListener(this);
    } catch (_) {}
  }
}
