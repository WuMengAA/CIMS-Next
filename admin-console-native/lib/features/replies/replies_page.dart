/// 星集控 · 回复收件箱（双向消息闭环）
///
/// 被控端（教室大屏 / 桌面端）对互动通知的「确认 / 回复」与对指令的「执行回执」
/// 都从后端拉回来，在这里统一查看：
///   · 回执 Tab：谁确认了、回了什么（notice_replies）
///   · 执行 Tab：哪台设备对截图/锁屏/远控执行了（成功/失败+原因）（command_completions）
///
/// 数据源 = CIMS 管理端 /class/* 端点（Bearer 鉴权）；接口不可用/无数据时如实显示空态，
/// 绝不编造条目。
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/models.dart';
import '../../core/settings.dart';

/// 回复收件箱页面（侧栏「回复收件箱」入口）。
class RepliesPage extends ConsumerStatefulWidget {
  const RepliesPage({super.key});

  @override
  ConsumerState<RepliesPage> createState() => _RepliesPageState();
}

class _RepliesPageState extends ConsumerState<RepliesPage>
    with SingleTickerProviderStateMixin {
  late final TabController _tab;
  bool _busy = false;
  String? _note;

  List<NoticeReply> _replies = const [];
  List<CommandCompletion> _completions = const [];

  @override
  void initState() {
    super.initState();
    _tab = TabController(length: 2, vsync: this);
    _refresh();
  }

  @override
  void dispose() {
    _tab.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    if (_busy) return;
    setState(() => _busy = true);
    final api = ref.read(apiProvider);
    if (!api.canUseBackend) {
      setState(() {
        _note = '还没连接学校服务器，请先到「设置」登录';
        _busy = false;
      });
      return;
    }
    final replies = await api.listNoticeReplies();
    final completions = await api.listCompletions();
    if (!mounted) return;
    setState(() {
      _replies = replies ?? const [];
      _completions = completions ?? const [];
      _note = (replies == null && completions == null)
          ? '接口暂不可用（未接入回复/执行回执服务）'
          : null;
      _busy = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final id = ref.watch(settingsProvider.select((s) => s.identity));
    final classLabel = [
      if (id != null) id.gradeName,
      if (id != null) id.className,
    ].where((e) => e.isNotEmpty).join(' ');

    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('回复收件箱', style: theme.textTheme.titleMedium),
          const SizedBox(height: 4),
          Text(
            '被控端确认/回复与执行回执（双向消息闭环）。'
            + (classLabel.isNotEmpty ? '范围：$classLabel' : ''),
            style: theme.textTheme.bodySmall,
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TabBar(
                  controller: _tab,
                  tabs: const [
                    Tab(text: '确认/回复'),
                    Tab(text: '执行回执'),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              FilledButton.tonalIcon(
                onPressed: _busy ? null : _refresh,
                icon: _busy
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.refresh, size: 18),
                label: const Text('刷新'),
              ),
            ],
          ),
          if (_note != null)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Text(_note!,
                  style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant)),
            ),
          const SizedBox(height: 8),
          Expanded(
            child: TabBarView(
              controller: _tab,
              children: [
                _ReplyList(items: _replies, empty: '还没有设备回复。'),
                _CompletionList(items: _completions, empty: '还没有设备执行回执。'),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// 确认/回复回执列表。
class _ReplyList extends StatelessWidget {
  final List<NoticeReply> items;
  final String empty;
  const _ReplyList({required this.items, required this.empty});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (items.isEmpty) {
      return Center(
        child: Text(empty, style: theme.textTheme.bodySmall),
      );
    }
    return ListView.separated(
      itemCount: items.length,
      separatorBuilder: (_, _) => const Divider(height: 1),
      itemBuilder: (context, i) {
        final r = items[i];
        return ListTile(
          leading: CircleAvatar(
            radius: 16,
            backgroundColor: theme.colorScheme.primaryContainer,
            child: Icon(Icons.reply,
                size: 16, color: theme.colorScheme.onPrimaryContainer),
          ),
          title: Text(r.text, style: const TextStyle(fontSize: 14)),
          subtitle: Text(
            r.clientId + (r.noticeId.isNotEmpty ? ' · #${r.noticeId}' : '')
            + ' · ' + _fmt(r.at),
            style: theme.textTheme.bodySmall,
          ),
        );
      },
    );
  }
}

/// 执行回执列表。
class _CompletionList extends StatelessWidget {
  final List<CommandCompletion> items;
  final String empty;
  const _CompletionList({required this.items, required this.empty});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (items.isEmpty) {
      return Center(
        child: Text(empty, style: theme.textTheme.bodySmall),
      );
    }
    return ListView.separated(
      itemCount: items.length,
      separatorBuilder: (_, _) => const Divider(height: 1),
      itemBuilder: (context, i) {
        final c = items[i];
        return ListTile(
          leading: CircleAvatar(
            radius: 16,
            backgroundColor: c.ok
                ? theme.colorScheme.primaryContainer
                : theme.colorScheme.errorContainer,
            child: Icon(
              c.ok ? Icons.check_circle_outline : Icons.error_outline,
              size: 16,
              color: c.ok
                  ? theme.colorScheme.onPrimaryContainer
                  : theme.colorScheme.onErrorContainer,
            ),
          ),
          title: Text(
            '${c.action} · ${c.ok ? '已执行' : '失败'}',
            style: TextStyle(
              fontSize: 14,
              color: c.ok ? null : theme.colorScheme.error,
            ),
          ),
          subtitle: Text(
            c.detail.isNotEmpty ? c.detail : '${c.clientId} · ${_fmt(c.at)}',
            style: theme.textTheme.bodySmall,
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
          ),
        );
      },
    );
  }
}

String _fmt(DateTime dt) {
  final local = dt.toLocal();
  final now = DateTime.now();
  final sameDay = local.year == now.year &&
      local.month == now.month &&
      local.day == now.day;
  if (sameDay) return '今天 ${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
  return '${local.month.toString().padLeft(2, '0')}-${local.day.toString().padLeft(2, '0')} ${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
}
