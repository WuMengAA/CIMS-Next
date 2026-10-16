/// 星集控 · 发通知（CIMS send-notification 下发 + 站点留痕）
///
/// 老师的任务是「把一句话送到某个班的屏幕上」——所以这里只有：
///   写一句话 + 选发给谁（全校 / 某个班）+ 一个发送按钮。
/// 送达结果按真实台数回报，不用 200 冒充成功。
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/models.dart';
import '../devices/devices_page.dart';

/// 快捷短语：老师最常发的几句话，点一下即填，避免每次手打。
const _quickPhrases = [
  '请各班安静下来，准备上课',
  '今天下午第三节课后请到多功能厅集合',
  '请关闭教室大屏，准备放学',
  '临时通知：请班主任到会议室',
];

class BroadcastPage extends ConsumerStatefulWidget {
  const BroadcastPage({super.key});

  @override
  ConsumerState<BroadcastPage> createState() => _BroadcastPageState();
}

class _BroadcastPageState extends ConsumerState<BroadcastPage> {
  final _title = TextEditingController();
  final _body = TextEditingController();
  bool _busy = false;

  /// 发送对象：'全校' 或某个班级名（人类可读，绝不出现设备 uid / 班级编码）。
  String _target = '全校';

  /// 通知方式：island（岛内）/ popup（弹窗）/ fullscreen（全屏紧急）。
  String _kind = 'island';

  /// 显示时长（秒；0 = 默认 5s）。
  int _duration = 0;
  static const _durations = <int>[0, 5, 10, 15, 30, 60];

  /// popup/fullscreen 是否需要手动确认。
  bool _requireAck = false;

  @override
  void dispose() {
    _title.dispose();
    _body.dispose();
    super.dispose();
  }

  /// 由设备列表汇总出「可以发给谁」的选项（去重后的班级名）。
  List<String> _targets(List<CimsDevice> devices) {
    final names = <String>{};
    for (final d in devices) {
      if (d.className.isNotEmpty) names.add(d.className);
    }
    final sorted = names.toList()..sort();
    return ['全校', ...sorted];
  }

  List<String>? _uidsFor(List<CimsDevice> devices) {
    if (_target == '全校') return null;
    return devices
        .where((d) => d.className == _target)
        .map((d) => d.uid)
        .toList();
  }

  Future<void> _send(List<CimsDevice> devices) async {
    final title = _title.text.trim();
    if (title.isEmpty) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('请先写通知标题（或正文）')));
      return;
    }
    final api = ref.read(apiProvider);
    if (!api.canUseBackend) {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('还没连接学校服务器，请先到「设置」登录')));
      return;
    }
    final onlyUids = _uidsFor(devices);
    if (onlyUids != null && onlyUids.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('「' + _target + '」名下还没有可接收的设备')));
      return;
    }
    setState(() => _busy = true);
    try {
      final sent = await api.sendNotice(
        title,
        body: _body.text.trim(),
        scope: _target,
        kind: _kind,
        durationSeconds: _duration,
        requireAck: _requireAck,
        onlyUids: onlyUids,
      );
      if (!mounted) return;
      if (sent > 0) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('已送到 ' + sent.toString() + ' 台设备的屏幕')));
        _title.clear();
        _body.clear();
      } else {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('没有设备收到通知，请确认目标教室的电脑是否开机')));
      }
      ref.invalidate(_noticesProvider);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('发送失败：' + e.toString())));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final notices = ref.watch(_noticesProvider);
    final devicesAsync = ref.watch(devicesProvider);
    final devices = devicesAsync.valueOrNull ?? const <CimsDevice>[];
    final targets = _targets(devices);
    if (!targets.contains(_target)) {
      _target = '全校';
    }

    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('发通知', style: theme.textTheme.titleMedium),
          const SizedBox(height: 4),
          Text('把一条消息送到教室大屏：可选岛内 / 弹窗 / 全屏紧急三种呈现。',
              style: theme.textTheme.bodySmall),
          const SizedBox(height: 16),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // ── 通知方式 ──
                  Text('通知方式', style: theme.textTheme.labelLarge),
                  const SizedBox(height: 6),
                  SegmentedButton<String>(
                    segments: const [
                      ButtonSegment(
                          value: 'island',
                          icon: Icon(Icons.article_outlined),
                          label: Text('岛内普通')),
                      ButtonSegment(
                          value: 'popup',
                          icon: Icon(Icons.mail_outline),
                          label: Text('弹窗通知')),
                      ButtonSegment(
                          value: 'fullscreen',
                          icon: Icon(Icons.fullscreen),
                          label: Text('全屏紧急')),
                    ],
                    selected: {_kind},
                    onSelectionChanged: (s) =>
                        setState(() => _kind = s.first),
                  ),
                  const SizedBox(height: 12),

                  // ── 标题 ──
                  TextField(
                    controller: _title,
                    maxLines: 1,
                    decoration: const InputDecoration(
                      labelText: '标题',
                      hintText: '例如：下午第三节课改到多功能厅',
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _body,
                    maxLines: 2,
                    minLines: 1,
                    decoration: const InputDecoration(
                      labelText: '正文（可选）',
                      hintText: '详细内容，显示在标题下方',
                    ),
                  ),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 4,
                    children: _quickPhrases
                        .map((p) => ActionChip(
                              label: Text(p, style: const TextStyle(fontSize: 12)),
                              onPressed: () => setState(() => _title.text = p),
                            ))
                        .toList(),
                  ),
                  const SizedBox(height: 12),

                  // ── 时长 / 需确认（弹窗与全屏生效；岛内发送时忽略）──
                  
                    Row(
                      children: [
                        Expanded(
                          child: DropdownButtonFormField<int>(
                            initialValue: _duration,
                            decoration: const InputDecoration(labelText: '显示时长'),
                            items: [
                              for (final d in _durations)
                                DropdownMenuItem(
                                    value: d,
                                    child: Text(d == 0
                                        ? '默认（5 秒）'
                                        : d.toString() + ' 秒' + (d >= 30 ? '（长时间）' : ''))),
                            ],
                            onChanged: (v) => setState(() => _duration = v ?? 0),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: CheckboxListTile(
                            value: _requireAck,
                            onChanged: (v) => setState(() => _requireAck = v ?? false),
                            title: const Text('需确认收到', style: TextStyle(fontSize: 13)),
                            subtitle: Text('回执上报操控端',
                                style: TextStyle(
                                    fontSize: 11,
                                    color: theme.colorScheme.onSurfaceVariant)),
                            dense: true,
                            contentPadding: EdgeInsets.zero,
                            controlAffinity: ListTileControlAffinity.leading,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),

                  // ── 发给谁 + 发送 ──
                  Row(
                    children: [
                      Expanded(
                        child: DropdownButtonFormField<String>(
                          initialValue: _target,
                          decoration: const InputDecoration(labelText: '发给谁'),
                          items: targets
                              .map((t) => DropdownMenuItem(
                                  value: t,
                                  child: Text(
                                      t == '全校' ? '全校所有教室' : t)))
                              .toList(),
                          onChanged: (v) =>
                              setState(() => _target = v ?? '全校'),
                        ),
                      ),
                      const SizedBox(width: 12),
                      FilledButton.icon(
                        onPressed: _busy ? null : () => _send(devices),
                        icon: _busy
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child:
                                    CircularProgressIndicator(strokeWidth: 2))
                            : const Icon(Icons.campaign),
                        label: const Text('发送'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          Text('最近发送', style: theme.textTheme.titleSmall),
          const SizedBox(height: 8),
          Expanded(
            child: notices.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, _) => Center(child: Text('加载失败：' + e.toString())),
              data: (list) => list.isEmpty
                  ? Center(
                      child: Text('还没有发送过通知',
                          style: theme.textTheme.bodySmall))
                  : ListView.builder(
                      itemCount: list.length,
                      itemBuilder: (c, i) {
                        final n = list[i];
                        return ListTile(
                          leading: const Icon(Icons.notifications_none),
                          title: Text(n.title),
                          subtitle: Text(
                              '' + (n.scope.isEmpty ? '全校' : n.scope) + ' · ' + n.at,
                              style: theme.textTheme.bodySmall),
                        );
                      },
                    ),
            ),
          ),
        ],
      ),
    );
  }
}

final _noticesProvider = FutureProvider<List<NoticeItem>>((ref) async {
  return ref.read(apiProvider).listNotices();
});
