/// 星集控 · 设置页「本机被控」卡片
///
/// 把这台电脑变成集控里的一台可管设备：开关、设备名、运行状态、开机自启。
///
/// 为什么放在设置页而不是单独一栏：它一辈子只会开一次（开完就忘），不是日常动作。
/// 但**开关状态必须显眼** —— 主界面顶栏那个「本机被控中」的胶囊就是为了让用户
/// 随时知道"这台机器现在能不能被别人关机"。
library;

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/device_agent.dart';
import '../../core/screen_shot.dart';
import '../../core/settings.dart';
import '../../core/tray.dart';

class AgentCard extends ConsumerStatefulWidget {
  const AgentCard({super.key});

  @override
  ConsumerState<AgentCard> createState() => _AgentCardState();
}

class _AgentCardState extends ConsumerState<AgentCard> {
  late final TextEditingController _uid;
  bool _startup = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _uid = TextEditingController(text: ref.read(settingsProvider).deviceName);
    _loadStartup();
  }

  Future<void> _loadStartup() async {
    try {
      final on = await ref.read(shellProvider).readStartWithWindows();
      if (mounted) setState(() => _startup = on);
    } catch (_) {
      // 测试环境没有真外壳：忽略即可，不影响其余功能
    }
  }

  @override
  void dispose() {
    _uid.dispose();
    super.dispose();
  }

  void _toast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  Future<void> _saveUid() async {
    // 改名只改展示名（deviceName），绑定键 deviceUid 不动 → 后端按 uid 更新同一台设备，
    // 不会新建（票 #246）。保存后立刻按新展示名报到，面板即刻可见。
    ref.read(settingsProvider.notifier).setDeviceName(_uid.text);
    _uid.text = ref.read(settingsProvider).deviceName;
    if (ref.read(settingsProvider).agentEnabled) {
      await ref.read(deviceAgentProvider).reportNow();
    }
    _toast('设备名已保存');
  }

  Future<void> _toggle(bool v) async {
    ref.read(settingsProvider.notifier).setAgentEnabled(v);
    ref.read(deviceAgentProvider).sync();
    if (v) {
      final r = await ref.read(deviceAgentProvider).reportNow();
      _toast(r.ok ? '已开启，并已向集控端报到' : '已开启，但上报失败：${r.detail}');
    } else {
      _toast('已关闭，这台电脑不再接收下发指令');
    }
  }

  Future<void> _openShots(String path) async {
    final dir = path.isNotEmpty
        ? path.substring(0, path.lastIndexOf(RegExp(r'[\\/]')))
        : ScreenShot.shotsDir().path;
    try {
      await Process.start('explorer.exe', [dir]);
    } catch (e) {
      _toast('打不开目录：$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final s = ref.watch(settingsProvider);
    final agent = ref.watch(deviceAgentProvider);
    final blocker = s.agentBlocker;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('本机被控（这台电脑）', style: theme.textTheme.titleSmall),
            const SizedBox(height: 4),
            Text(
              '开启后，这台电脑会出现在集控面板的设备列表里，可以对它关机、重启、锁屏、截屏、调音量、发通知。',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: 4),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: s.agentEnabled,
              // 没配好就不给开：开了也是"看着像开了、其实什么都没发生"
              onChanged: (blocker != null && !s.agentEnabled) ? null : _toggle,
              title: const Text('允许被远程管理'),
              subtitle: Text(
                blocker ?? '关掉窗口不会退出，会缩到右下角托盘里继续待命',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: blocker != null
                      ? theme.colorScheme.error
                      : theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ),
            ValueListenableBuilder<AgentStatus>(
              valueListenable: agent.status,
              builder: (_, st, _) {
                if (!s.agentEnabled) return const SizedBox.shrink();
                return Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  margin: const EdgeInsets.only(bottom: 8),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Icon(Icons.circle,
                              size: 9,
                              color: st.live
                                  ? const Color(0xFF3DDC84)
                                  : theme.colorScheme.error),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(st.phase,
                                style: const TextStyle(
                                    fontSize: 13, fontWeight: FontWeight.w600)),
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(_line(st),
                          style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant)),
                      if (st.lastAction.isNotEmpty) ...[
                        const SizedBox(height: 4),
                        Text('最近执行：${st.lastAction}',
                            style: theme.textTheme.bodySmall),
                      ],
                      if (st.lastError.isNotEmpty) ...[
                        const SizedBox(height: 4),
                        Text('最近失败：${st.lastError}',
                            style: theme.textTheme.bodySmall
                                ?.copyWith(color: theme.colorScheme.error)),
                      ],
                      if (st.lastShot.isNotEmpty) _shot(theme, st),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          OutlinedButton.icon(
                            onPressed: _busy ? null : () => _report(agent),
                            icon: const Icon(Icons.upload_outlined, size: 18),
                            label: const Text('立即上报'),
                          ),
                          const SizedBox(width: 8),
                          TextButton(
                            onPressed: () => _openShots(st.lastShot),
                            child: const Text('截图目录'),
                          ),
                        ],
                      ),
                    ],
                  ),
                );
              },
            ),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _uid,
                    decoration: const InputDecoration(
                      labelText: '设备名（展示名）',
                      helperText:
                          '只是改名，不会新建设备：绑定身份保持不变，面板里还是同一台机器。留空回落到身份键。',
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton.tonal(onPressed: _saveUid, child: const Text('保存')),
              ],
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: _startup,
              onChanged: (v) async {
                final ok = await ref.read(shellProvider).setStartWithWindows(v);
                if (mounted) setState(() => _startup = ok);
                if (!ok) _toast('系统拒绝了开机自启设置');
              },
              title: const Text('开机自动启动'),
              subtitle: Text(
                  '被控机器必须自己回来，否则人一走就管不了。绿色版换过文件夹要重新开一次。',
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
            ),
            Text('开启并上报成功后，去网站后台把这台设备划进某个班，它就会出现在面板里。',
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
          ],
        ),
      ),
    );
  }

  Future<void> _report(DeviceAgent agent) async {
    setState(() => _busy = true);
    final r = await agent.reportNow();
    if (!mounted) return;
    setState(() => _busy = false);
    _toast(r.ok ? '已向集控端上报本机状态' : '上报失败：${r.detail}');
  }

  Widget _shot(ThemeData theme, AgentStatus st) {
    final exists = File(st.lastShot).existsSync();
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Row(
        children: [
          if (exists)
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: Image.file(File(st.lastShot),
                  width: 96, height: 54, fit: BoxFit.cover),
            ),
          const SizedBox(width: 10),
          Expanded(
            child: Text('最近截图：${st.lastShot}',
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.bodySmall),
          ),
          TextButton(
              onPressed: () => _openShots(st.lastShot), child: const Text('打开')),
        ],
      ),
    );
  }

  static String _line(AgentStatus st) {
    final buf = StringBuffer('设备名 ${st.uid}');
    if (st.lastReportAt != null) {
      buf.write(' · 上次上报 ${hhmmss(st.lastReportAt!)}');
    }
    if (st.lastPollAt != null) {
      buf.write(' · 上次取指令 ${hhmmss(st.lastPollAt!)}');
    }
    return buf.toString();
  }

  static String hhmmss(DateTime t) {
    String two(int v) => v.toString().padLeft(2, '0');
    return '${two(t.hour)}:${two(t.minute)}:${two(t.second)}';
  }
}
