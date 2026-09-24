/// 星集控 · 安卓端「老师」首页（Teacher view）
///
/// 老师身份在安卓上的聚合入口：班级、广播、审核三个最常用的动作集中成
/// 大号触控卡片，点一下进入对应的功能页。与桌面端共用同一套 Riverpod
/// provider（settingsProvider / identity），不另起状态。
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/settings.dart';
import '../broadcast/broadcast_page.dart';
import '../devices/devices_page.dart';
import '../review/review_page.dart';

class TeacherPage extends ConsumerWidget {
  const TeacherPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final id = ref.watch(settingsProvider.select((s) => s.identity));
    final classLabel = [
      if (id != null) id.gradeName,
      if (id != null) id.className,
    ].where((e) => e.isNotEmpty).join(' ');

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    CircleAvatar(
                      radius: 22,
                      backgroundColor: theme.colorScheme.primaryContainer,
                      child: Icon(Icons.school,
                          color: theme.colorScheme.onPrimaryContainer),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            id != null && id.displayName.isNotEmpty
                                ? id.displayName
                                : '老师，你好',
                            style: theme.textTheme.titleMedium
                                ?.copyWith(fontWeight: FontWeight.w600),
                          ),
                          if (classLabel.isNotEmpty)
                            Text('任教：$classLabel',
                                style: theme.textTheme.bodySmall?.copyWith(
                                    color: theme.colorScheme.onSurfaceVariant)),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  id != null && id.blurb.isNotEmpty
                      ? id.blurb
                      : '看本班设备、发通知、处理待审核内容。',
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        _Tile(
          icon: Icons.devices_other,
          title: '我的班级',
          subtitle: classLabel.isNotEmpty ? '查看 $classLabel 的设备状态' : '查看本班设备状态',
          onTap: () => _push(context, DevicesPage()),
        ),
        _Tile(
          icon: Icons.campaign,
          title: '广播通知',
          subtitle: '给本班 / 本年级发一条通知',
          onTap: () => _push(context, BroadcastPage()),
        ),
        _Tile(
          icon: Icons.fact_check,
          title: '待审核',
          subtitle: '审核内容与权限申请',
          onTap: () => _push(context, ReviewPage()),
        ),
      ],
    );
  }

  void _push(BuildContext context, Widget page) {
    Navigator.of(context)
        .push(MaterialPageRoute(builder: (_) => page));
  }
}

class _Tile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  const _Tile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  color: theme.colorScheme.primaryContainer,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(icon, color: theme.colorScheme.onPrimaryContainer),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title,
                        style: theme.textTheme.titleMedium
                            ?.copyWith(fontWeight: FontWeight.w600)),
                    const SizedBox(height: 2),
                    Text(subtitle,
                        style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant)),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right),
            ],
          ),
        ),
      ),
    );
  }
}
