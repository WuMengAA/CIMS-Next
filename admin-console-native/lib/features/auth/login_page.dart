/// 星集控 · 登录页
///
/// 两条登录路径，**默认走网站账号**：
///   ① 网站账号（推荐，老师用这条）：拉起浏览器在站点上授权 → 拿网站会话令牌 → 走代理模式。
///      站点地址有默认值（见 settings.dart 的 kDefaultSiteHost），**老师不需要填任何地址**。
///   ② 本机直连 CIMS 管理端口：仅当"客户端与服务端装在同一台机器"时才成立（运维排障用），
///      已折进「高级」——它不是普通老师的登录路径，之前却占据了首屏默认值，
///      导致老师一点登录就连 127.0.0.1，看起来像"登录非走本机/内网不可"。
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/settings.dart';

class LoginPage extends ConsumerStatefulWidget {
  const LoginPage({super.key});

  @override
  ConsumerState<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends ConsumerState<LoginPage> {
  final _host = TextEditingController();
  final _email = TextEditingController();
  final _pwd = TextEditingController();
  final _site = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final s = ref.read(settingsProvider);
    _host.text = s.mgmtHost;
    // 站点地址：已存过就用存的；没存过用**公网默认站点**，绝不回落到 127.0.0.1
    // （那台机器上没有网站服务，点登录必然打不开）。
    _site.text = s.siteHost.isNotEmpty ? s.siteHost : kDefaultSiteHost;
  }

  @override
  void dispose() {
    _host.dispose();
    _email.dispose();
    _pwd.dispose();
    _site.dispose();
    super.dispose();
  }

  /// 网站账号登录（首屏主路径）。
  Future<void> _loginWithWebsite() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(apiProvider).loginWithOAuth(_site.text.trim());
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// 直连 CIMS 管理端口（高级，运维用）。
  Future<void> _login() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final api = ref.read(apiProvider);
      await api.login(_host.text.trim(), _email.text.trim(), _pwd.text);
    } catch (e) {
      if (mounted) {
        setState(() => _error = e.toString());
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _demo() {
    ref.read(settingsProvider.notifier).setDemo(true);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final s = ref.watch(settingsProvider);
    final siteLabel = _site.text
        .replaceFirst(RegExp(r'^https?://'), '')
        .replaceAll(RegExp(r'/+$'), '');
    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Icon(Icons.auto_awesome, size: 44, color: theme.colorScheme.primary),
                const SizedBox(height: 12),
                Text('星集控',
                    textAlign: TextAlign.center,
                    style: theme.textTheme.headlineMedium
                        ?.copyWith(fontWeight: FontWeight.w600)),
                const SizedBox(height: 4),
                Text('独立桌面集控端 · 设备管控 / 广播通知 / 课堂工具',
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodySmall
                        ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                const SizedBox(height: 24),

                // ── 主路径：网站账号登录 ──────────────────────────────
                FilledButton.icon(
                  onPressed: _busy ? null : _loginWithWebsite,
                  icon: const Icon(Icons.login),
                  label: Text(_busy ? '正在打开浏览器…' : '登录'),
                  style: FilledButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 15)),
                ),
                const SizedBox(height: 8),
                Text(
                  '在浏览器里用学校账号登录，授权后自动回到这里',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
                const SizedBox(height: 10),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.language_outlined,
                          size: 18, color: theme.colorScheme.onSurfaceVariant),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          '将连接：$siteLabel',
                          style: theme.textTheme.bodySmall,
                        ),
                      ),
                    ],
                  ),
                ),

                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.errorContainer,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(_error!,
                        style: TextStyle(color: theme.colorScheme.onErrorContainer)),
                  ),
                ],

                const SizedBox(height: 6),
                TextButton(
                  onPressed: _busy ? null : _demo,
                  child: const Text('进入演示模式（不连后端）'),
                ),

                // ── 高级：地址 + 本机直连（不是给老师用的）──────────────
                Theme(
                  data: theme.copyWith(dividerColor: Colors.transparent),
                  child: ExpansionTile(
                    tilePadding: EdgeInsets.zero,
                    childrenPadding: const EdgeInsets.only(bottom: 8),
                    title: Text('高级 · 站点地址与本机直连',
                        style: theme.textTheme.bodySmall
                            ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                    children: [
                      TextField(
                        controller: _site,
                        onChanged: (_) => setState(() {}),
                        decoration: const InputDecoration(
                          labelText: '站点地址',
                          hintText: 'https://www.example.edu',
                          prefixIcon: Icon(Icons.language_outlined),
                        ),
                      ),
                      const SizedBox(height: 6),
                      Align(
                        alignment: Alignment.centerLeft,
                        child: Text('　换学校/自建站点时才需要改这里。',
                            style: theme.textTheme.bodySmall?.copyWith(
                                color: theme.colorScheme.onSurfaceVariant)),
                      ),
                      const Divider(height: 24),
                      Text('本机直连（仅"客户端与服务端装在同一台机器"时可用）',
                          style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant)),
                      const SizedBox(height: 8),
                      TextField(
                        controller: _host,
                        decoration: const InputDecoration(
                          labelText: '管理端口地址',
                          hintText: kLocalMgmtHost,
                          prefixIcon: Icon(Icons.dns_outlined),
                        ),
                      ),
                      const SizedBox(height: 8),
                      TextField(
                        controller: _email,
                        decoration: const InputDecoration(
                          labelText: '管理员邮箱',
                          prefixIcon: Icon(Icons.mail_outline),
                        ),
                      ),
                      const SizedBox(height: 8),
                      TextField(
                        controller: _pwd,
                        obscureText: true,
                        onSubmitted: (_) => _login(),
                        decoration: const InputDecoration(
                          labelText: '密码',
                          prefixIcon: Icon(Icons.lock_outline),
                        ),
                      ),
                      const SizedBox(height: 10),
                      OutlinedButton(
                        onPressed: _busy ? null : _login,
                        child: const Text('用管理员账号直连本机后端'),
                      ),
                      if (s.mgmtHost.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 6),
                          child: Text('　当前已探测到本机后端：${s.mgmtHost}',
                              style: theme.textTheme.bodySmall?.copyWith(
                                  color: theme.colorScheme.onSurfaceVariant)),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
