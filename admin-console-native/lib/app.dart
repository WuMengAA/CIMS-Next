/// 星集控 · 应用根（主题 / 路由 / 登录门禁）
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/log.dart';
import 'core/settings.dart';
import 'features/auth/login_page.dart';
import 'features/debug/debug_page.dart';
import 'features/home/home_page.dart';
import 'features/home/notice_popup.dart';

/// 全局导航键：供 F12 调试面板在任意页面（含登录页）打开
final GlobalKey<NavigatorState> appNavigatorKey = GlobalKey<NavigatorState>();

/// 打开调试面板（排障用）。入口有二：F12 快捷键，或「设置 → 高级」里的按钮。
/// 调试面板刻意不放进左侧主导航——老师的界面里不该出现「调试」这一栏。
void openDebugPanel() {
  final ctx = appNavigatorKey.currentContext;
  if (ctx == null) return;
  Log.i('打开调试面板', 'debug');
  Navigator.of(ctx).push(MaterialPageRoute(builder: (_) => const DebugPage()));
}

class OpenDebugIntent extends Intent {
  const OpenDebugIntent();
}

class XingjikongApp extends ConsumerWidget {
  const XingjikongApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final dark = ref.watch(settingsProvider.select((s) => s.dark));
    return Shortcuts(
      shortcuts: const <ShortcutActivator, Intent>{
        SingleActivator(LogicalKeyboardKey.f12): OpenDebugIntent(),
        SingleActivator(LogicalKeyboardKey.keyD, control: true, shift: true):
            OpenDebugIntent(),
      },
      child: Actions(
        actions: <Type, Action<Intent>>{
          OpenDebugIntent: CallbackAction<OpenDebugIntent>(
            onInvoke: (intent) {
              openDebugPanel();
              return null;
            },
          ),
        },
        child: Focus(
          autofocus: true,
          child: MaterialApp(
            navigatorKey: appNavigatorKey,
            title: '星集控',
            debugShowCheckedModeBanner: false,
            theme: _lightTheme(),
            darkTheme: _darkTheme(),
            themeMode: dark ? ThemeMode.dark : ThemeMode.light,
            // 通知弹窗挂在 MaterialApp 之上（`builder` 而非 home 里）：
            // 登录页也可能收到"你已被绑定"/"本机已上线"这类提示，
            // 挂进 home 就会漏掉未登录状态。见 features/home/notice_popup.dart。
            builder: (context, child) =>
                NoticePopup(child: child ?? const SizedBox.shrink()),
            home: const AuthGate(),
          ),
        ),
      ),
    );
  }

  static ThemeData _darkTheme() {
    final scheme = ColorScheme.fromSeed(
      seedColor: const Color(0xFF534AB7),
      brightness: Brightness.dark,
      surface: const Color(0xFF17151F),
    );
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: const Color(0xFF12101A),
      appBarTheme: AppBarTheme(
        backgroundColor: const Color(0xFF17151F),
        foregroundColor: scheme.onSurface,
        elevation: 0,
      ),
      navigationRailTheme: const NavigationRailThemeData(
        backgroundColor: Color(0xFF17151F),
        indicatorColor: Color(0xFF534AB7),
      ),
      cardTheme: CardThemeData(
        color: const Color(0xFF1D1A28),
        elevation: 0,
        // 边框只能挂在 shape 上：CardThemeData 没有 `side` 参数
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(color: Colors.white.withValues(alpha: 0.06)),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: const Color(0xFF1D1A28),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.10)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.10)),
        ),
      ),
      snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
    );
  }

  static ThemeData _lightTheme() {
    final scheme = ColorScheme.fromSeed(
      seedColor: const Color(0xFF534AB7),
      brightness: Brightness.light,
    );
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      navigationRailTheme: const NavigationRailThemeData(
        backgroundColor: Color(0xFFF4F2FA),
        indicatorColor: Color(0xFFD9D3F5),
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(color: Colors.black.withValues(alpha: 0.06)),
        ),
      ),
      snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
    );
  }
}

/// 登录门禁：有 token（或演示模式）进主页，否则登录页
class AuthGate extends ConsumerWidget {
  const AuthGate({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(settingsProvider);
    final authed = s.demo || s.token.isNotEmpty;
    return authed ? const HomePage() : const LoginPage();
  }
}
