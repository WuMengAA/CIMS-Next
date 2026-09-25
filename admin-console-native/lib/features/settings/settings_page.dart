/// 星集控 · 设置
///
/// 原则：默认界面只出现「人看得懂的话」——
///   连接状态用一句中文描述（已连接 / 未连接 / 演示模式），
///   地址、端口、密钥一律收进「高级」折叠区，普通老师不需要看见、更不需要填。
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/settings.dart';
import '../../core/update_action.dart';
import '../../core/update_check.dart';
import '../../core/updater.dart';
import '../debug/debug_page.dart';
import '../devices/devices_page.dart';
import 'agent_card.dart';

class SettingsPage extends ConsumerStatefulWidget {
  const SettingsPage({super.key});

  @override
  ConsumerState<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends ConsumerState<SettingsPage> {
  late final TextEditingController _mgmt;
  late final TextEditingController _client;
  late final TextEditingController _ext;
  late final TextEditingController _site;
  late final TextEditingController _secret;
  late final TextEditingController _deviceSecret;

  @override
  void initState() {
    super.initState();
    final s = ref.read(settingsProvider);
    _mgmt = TextEditingController(text: s.mgmtHost);
    _client = TextEditingController(text: s.clientHost);
    _ext = TextEditingController(text: s.extHost);
    _site = TextEditingController(text: s.siteHost);
    _secret = TextEditingController(text: s.taskSecret);
    _deviceSecret = TextEditingController(text: s.deviceSecret);
  }

  @override
  void dispose() {
    _mgmt.dispose();
    _client.dispose();
    _ext.dispose();
    _site.dispose();
    _secret.dispose();
    _deviceSecret.dispose();
    super.dispose();
  }

  void _save() {
    final n = ref.read(settingsProvider.notifier);
    n.setMgmtHost(_mgmt.text);
    n.setClientHost(_client.text);
    n.setExtHost(_ext.text);
    n.setSiteHost(_site.text);
    n.setTaskSecret(_secret.text);
    n.setDeviceSecret(_deviceSecret.text);
    ScaffoldMessenger.of(context)
        .showSnackBar(const SnackBar(content: Text('设置已保存')));
  }

  void _logout() {
    ref.read(settingsProvider.notifier).clearAuth();
  }

  Future<void> _rediscover() async {
    final changed =
        await ref.read(settingsProvider.notifier).rediscoverLocalBackend();
    if (!mounted) return;
    // 同步输入框文本（探测会直接持久化，未必点「保存设置」）
    _mgmt.text = ref.read(settingsProvider).mgmtHost;
    _client.text = ref.read(settingsProvider).clientHost;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(changed ? '已找到本机服务，连接已就绪' : '本机没有找到服务，可稍后再试')));
  }

  /// 把「连接状态」翻译成一句人话 + 一个颜色，不暴露任何地址/端口。
  ({String text, String hint, Color color}) _statusOf(
      ThemeData theme, Settings s) {
    if (s.demo) {
      return (
        text: '演示模式',
        hint: '正在使用示例数据，不会连接真实教室',
        color: Colors.orangeAccent,
      );
    }
    if (s.canUseBackend) {
      return (
        text: '已连接',
        hint: '打开时自动找到本机服务，无需填写地址',
        color: const Color(0xFF3DDC84),
      );
    }
    if (s.token.isEmpty || s.accountId.isEmpty) {
      return (
        text: '未登录',
        hint: '登录后即可看到你的教室与设备',
        color: theme.colorScheme.error,
      );
    }
    return (
      text: '未连接',
      hint: '没找到服务，可点右侧「重新检测」',
      color: Colors.orangeAccent,
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final s = ref.watch(settingsProvider);
    final id = s.identity;
    final st = _statusOf(theme, s);
    return Padding(
      padding: const EdgeInsets.all(20),
      child: ListView(
        children: [
          Text('设置', style: theme.textTheme.titleMedium),
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        width: 10,
                        height: 10,
                        decoration: BoxDecoration(
                            color: st.color, shape: BoxShape.circle),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(st.text,
                                style: theme.textTheme.titleSmall
                                    ?.copyWith(fontWeight: FontWeight.w600)),
                            const SizedBox(height: 2),
                            Text(st.hint,
                                style: theme.textTheme.bodySmall?.copyWith(
                                    color: theme.colorScheme.onSurfaceVariant)),
                          ],
                        ),
                      ),
                      TextButton.icon(
                        onPressed: _rediscover,
                        icon: const Icon(Icons.refresh, size: 18),
                        label: const Text('重新检测'),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton(
                      onPressed: () => ref.invalidate(devicesProvider),
                      child: const Text('刷新教室列表'),
                    ),
                  ),
                  const Divider(height: 20),
                  Theme(
                    data: theme.copyWith(dividerColor: Colors.transparent),
                    child: ExpansionTile(
                      tilePadding: EdgeInsets.zero,
                      childrenPadding: const EdgeInsets.only(bottom: 8),
                      title: Text('高级 · 连接设置',
                          style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant)),
                      subtitle: Text('一般不用动；仅在服务装在别的电脑上时才需要',
                          style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant)),
                      children: [
                        TextField(
                            controller: _mgmt,
                            decoration: const InputDecoration(
                                labelText: '管理服务地址',
                                hintText: 'http://127.0.0.1:8097')),
                        const SizedBox(height: 10),
                        TextField(
                            controller: _client,
                            decoration: const InputDecoration(
                                labelText: '教室连接地址',
                                hintText: 'http://127.0.0.1:8096')),
                        const SizedBox(height: 10),
                        TextField(
                            controller: _ext,
                            decoration: const InputDecoration(
                                labelText: '扩展服务地址（可选）',
                                hintText: 'http://127.0.0.1:8111')),
                        const SizedBox(height: 10),
                        TextField(
                            controller: _site,
                            decoration: const InputDecoration(
                                labelText: '网站地址（登录/协作/上报都用它）',
                                hintText: kDefaultSiteHost,
                                helperText: '留空 = 用内置默认站点')),
                        const SizedBox(height: 14),
                        Align(
                          alignment: Alignment.centerLeft,
                          child: Text('设备通信密钥（可选）',
                              style: theme.textTheme.bodySmall),
                        ),
                        const SizedBox(height: 6),
                        TextField(
                            controller: _secret,
                            obscureText: true,
                            decoration: const InputDecoration(
                                labelText: '密钥',
                                hintText: '与设备端一致，留空即不校验')),
                        const SizedBox(height: 14),
                        Align(
                          alignment: Alignment.centerLeft,
                          child: Text('设备上报密钥（可选）',
                              style: theme.textTheme.bodySmall),
                        ),
                        const SizedBox(height: 6),
                        TextField(
                            controller: _deviceSecret,
                            obscureText: true,
                            decoration: const InputDecoration(
                                labelText: '上报密钥',
                                hintText: '截图回传鉴权用；与部署级 CONSOLE_DEVICE_REPORT_SECRET 一致',
                                helperText: '留空 = 截图只存本机、不回传集控端')),
                        const SizedBox(height: 12),
                        Align(
                          alignment: Alignment.centerLeft,
                          child: FilledButton(
                              onPressed: _save, child: const Text('保存')),
                        ),
                        const Divider(height: 24),
                        Align(
                          alignment: Alignment.centerLeft,
                          child: Text('排障',
                              style: theme.textTheme.bodySmall),
                        ),
                        const SizedBox(height: 4),
                        Align(
                          alignment: Alignment.centerLeft,
                          child: Text('遇到问题时打开诊断面板，可一键把现场信息发给技术人员。',
                              style: theme.textTheme.bodySmall?.copyWith(
                                  color: theme.colorScheme.onSurfaceVariant)),
                        ),
                        const SizedBox(height: 8),
                        Align(
                          alignment: Alignment.centerLeft,
                          child: OutlinedButton.icon(
                            onPressed: () => Navigator.of(context).push(
                                MaterialPageRoute(
                                    builder: (_) => const DebugPage())),
                            icon: const Icon(Icons.build_outlined, size: 18),
                            label: const Text('打开诊断面板'),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('账号', style: theme.textTheme.titleSmall),
                  const SizedBox(height: 8),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(
                      s.token.isNotEmpty ? Icons.verified_user : Icons.person_off,
                      color: s.token.isNotEmpty
                          ? const Color(0xFF3DDC84)
                          : theme.colorScheme.outline,
                    ),
                    title: Text(s.token.isNotEmpty ? '已登录' : '未登录'),
                    subtitle: Text(s.token.isNotEmpty
                        ? (s.authMode == 'website' ? '通过网站账号登录' : '已登录，可管理你的教室')
                        : '登录后才能管理教室；去登录页输入邮箱与密码即可'),
                    trailing: s.token.isNotEmpty
                        ? TextButton(onPressed: _logout, child: const Text('退出登录'))
                        : null,
                  ),
                  // 身份条：桌面端也把"我是谁、我能干什么"说清楚 ——
                  // 侧栏少了几项时，用户才知道那是身份所致，不是功能缺失。
                  if (id != null) ...[
                    const SizedBox(height: 4),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: theme.colorScheme.secondaryContainer,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Icon(Icons.badge_outlined,
                                  size: 16,
                                  color: theme.colorScheme.onSecondaryContainer),
                              const SizedBox(width: 6),
                              Text(
                                id.levelLabel.isNotEmpty
                                    ? '${id.levelLabel} · ${id.who}'
                                    : id.who,
                                style: TextStyle(
                                    fontSize: 13,
                                    fontWeight: FontWeight.w600,
                                    color: theme.colorScheme.onSecondaryContainer),
                              ),
                              if (id.className.isNotEmpty ||
                                  id.gradeName.isNotEmpty) ...[
                                const SizedBox(width: 8),
                                Text(
                                  [id.gradeName, id.className]
                                      .where((e) => e.isNotEmpty)
                                      .join(' '),
                                  style: TextStyle(
                                      fontSize: 12,
                                      color: theme.colorScheme.onSecondaryContainer
                                          .withValues(alpha: 0.8)),
                                ),
                              ],
                            ],
                          ),
                          if (id.blurb.isNotEmpty) ...[
                            const SizedBox(height: 4),
                            Text(id.blurb,
                                style: TextStyle(
                                    fontSize: 12.5,
                                    color: theme.colorScheme.onSecondaryContainer)),
                          ],
                          const SizedBox(height: 4),
                          Text('侧栏按这个身份摆放：不常用的入口收在「更多」里，功能并没有减少。',
                              style: TextStyle(
                                  fontSize: 11.5,
                                  color: theme.colorScheme.onSecondaryContainer
                                      .withValues(alpha: 0.75))),
                        ],
                      ),
                    ),
                  ],
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('演示模式（不连真实教室）'),
                    value: s.demo,
                    onChanged: (v) =>
                        ref.read(settingsProvider.notifier).setDemo(v),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          const AgentCard(),
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('外观', style: theme.textTheme.titleSmall),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('深色主题'),
                    value: s.dark,
                    onChanged: (v) =>
                        ref.read(settingsProvider.notifier).setDark(v),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('关于', style: theme.textTheme.titleSmall),
                  const SizedBox(height: 8),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.auto_awesome),
                    title: const Text('星集控 · 桌面集控端'),
                    subtitle: const Text('v1.0.0\n用一个界面管好全校教室的屏幕：看画面、发通知、开关机'),
                    isThreeLine: true,
                  ),
                  const SizedBox(height: 10),
                  const _UpdateCard(),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// 关于页的「自动更新」卡片（票 #245）：显示当前状态 + 可手动检查 + 可改更新源。
///
/// 状态三种：有更新 / 已是最新 / 暂时无法检查（接口没部署或网络不通，不报错、不假成功）。
class _UpdateCard extends ConsumerStatefulWidget {
  const _UpdateCard();

  @override
  ConsumerState<_UpdateCard> createState() => _UpdateCardState();
}

class _UpdateCardState extends ConsumerState<_UpdateCard> {
  late final TextEditingController _url;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _url = TextEditingController(text: ref.read(settingsProvider).updateUrl);
  }

  @override
  void dispose() {
    _url.dispose();
    super.dispose();
  }

  ({String text, Color color, IconData icon}) _statusOf(ThemeData theme) {
    final st = ref.watch(updateProvider);
    if (!st.reachable) {
      return (
        text: '暂时无法检查更新（接口可能未部署）',
        color: theme.colorScheme.onSurfaceVariant,
        icon: Icons.cloud_off,
      );
    }
    if (st.hasUpdate) {
      final v = st.latest;
      return (
        text: v != null && v.forced
            ? '当前版本已停用，需更新到 v${v.version}'
            : '发现新版本 v${v?.version ?? ''}',
        color: theme.colorScheme.primary,
        icon: Icons.system_update_alt,
      );
    }
    return (
      text: '已是最新（v$kLocalVersion）',
      color: const Color(0xFF3DDC84),
      icon: Icons.check_circle,
    );
  }

  Future<void> _check() async {
    setState(() => _busy = true);
    final s = ref.read(settingsProvider);
    await ref
        .read(updateProvider.notifier)
        .checkManually(siteHost: s.siteHost, updateUrl: s.updateUrl);
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final st = _statusOf(theme);
    final upd = ref.watch(updateProvider);
    final act = ref.watch(updateActionProvider);
    final actBusy = act != null &&
        act.phase != UpdatePhase.done &&
        act.phase != UpdatePhase.error;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(st.icon, size: 18, color: st.color),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                  actBusy ? (act.message) : st.text,
                  style: theme.textTheme.bodySmall?.copyWith(color: st.color)),
            ),
            if (upd.hasUpdate && upd.latest != null)
              FilledButton.icon(
                onPressed: actBusy
                    ? null
                    : () => ref
                        .read(updateActionProvider.notifier)
                        .start(upd.latest!),
                icon: actBusy
                    ? const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.download, size: 16),
                label: Text(actBusy ? '更新中' : '立即更新'),
              ),
            TextButton.icon(
              onPressed: _busy || actBusy ? null : _check,
              icon: const Icon(Icons.refresh, size: 16),
              label: const Text('检查更新'),
            ),
          ],
        ),
        if (actBusy && act.fraction != null) ...[
          const SizedBox(height: 6),
          LinearProgressIndicator(value: act.fraction),
        ],
        const SizedBox(height: 6),
        TextField(
          controller: _url,
          decoration: InputDecoration(
            labelText: '更新源地址（可选）',
            hintText: '留空 = 用登录站点 / 内置默认站点的 /api/version',
            helperText: '需要换更新源时填这里；填完整接口 URL 则不必带路径。',
            suffixIcon: IconButton(
              icon: const Icon(Icons.save_outlined, size: 18),
              tooltip: '保存更新源',
              onPressed: () {
                ref.read(settingsProvider.notifier).setUpdateUrl(_url.text);
                ScaffoldMessenger.of(context)
                    .showSnackBar(const SnackBar(content: Text('更新源已保存')));
              },
            ),
          ),
          onSubmitted: (v) =>
              ref.read(settingsProvider.notifier).setUpdateUrl(v),
        ),
      ],
    );
  }
}
