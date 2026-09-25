/// 通知历史侧栏 —— 老师回头还能翻的那一本账。
///
/// 为什么做成「右侧可折叠抽屉」而不是独立窗口（用户 2026-09-25 选定）：
/// 独立窗口在托盘常驻的软件里等于藏起来 —— 老师不会记得那儿还开着个窗口。
/// 抽屉挂在界面右侧、点一下就出来，收起时也不占地方。
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/log.dart';
import '../../core/notice_history.dart';

/// 抽屉开合（别的页面也能喊它打开 —— 例如主界面右上角的「历史」按钮）。
final ValueNotifier<bool> noticeDrawerOpen = ValueNotifier(false);

/// 右侧滑出的历史抽屉。折叠时只留一条窄边，老师一眼知道这儿能点。
class NoticeHistoryDrawer extends ConsumerStatefulWidget {
  const NoticeHistoryDrawer({super.key});

  @override
  ConsumerState<NoticeHistoryDrawer> createState() => _NoticeHistoryDrawerState();
}

class _NoticeHistoryDrawerState extends ConsumerState<NoticeHistoryDrawer> {
  /// 展开展开的那条的 seq（null = 全收起）
  int? _expanded;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: noticeDrawerOpen,
      builder: (context, open, _) {
        return AnimatedPositioned(
          duration: const Duration(milliseconds: 180),
          right: 0,
          top: 0,
          bottom: 0,
          // 收起时整条滑出屏幕右侧，只留 6px 的把手露在边缘
          width: open ? 340 : 6,
          child: IgnorePointer(
            ignoring: !open,
            child: Material(
              color: Theme.of(context).colorScheme.surface,
              child: open ? _body(context) : _handle(context),
            ),
          ),
        );
      },
    );
  }

  /// 收起状态：一条窄窄的竖条，写着「历史」二字（竖排），点开它。
  Widget _handle(BuildContext context) {
    return InkWell(
      onTap: () => noticeDrawerOpen.value = true,
      child: Container(
        color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.12),
        alignment: Alignment.center,
        child: const RotatedBox(
          quarterTurns: -1,
          child: Text(
            '历史消息',
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
          ),
        ),
      ),
    );
  }

  Widget _body(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final items = ref.watch(noticeHistoryProvider);
    return Column(
      children: [
        Container(
          decoration: BoxDecoration(
            color: scheme.primary.withValues(alpha: 0.10),
            border: Border(
                bottom: BorderSide(color: scheme.outlineVariant, width: 1)),
          ),
          padding: const EdgeInsets.fromLTRB(14, 14, 8, 10),
          child: Row(
            children: [
              const Icon(Icons.history_rounded, size: 18),
              const SizedBox(width: 8),
              const Text('历史消息', style: TextStyle(fontWeight: FontWeight.w700)),
              const Spacer(),
              IconButton(
                tooltip: '收起',
                onPressed: () => noticeDrawerOpen.value = false,
                icon: const Icon(Icons.keyboard_arrow_right_rounded, size: 20),
              ),
            ],
          ),
        ),
        Expanded(
          child: items.isEmpty
              ? const _Empty()
              : ListView.separated(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  itemCount: items.length,
                  separatorBuilder: (_, _) => const Divider(height: 1),
                  itemBuilder: (context, i) =>
                      _row(context, items[i], items[i].seq == _expanded),
                ),
        ),
        _footer(context),
      ],
    );
  }

  Widget _footer(BuildContext context) {
    final notifier = ref.watch(noticeHistoryProvider.notifier);
    return Container(
      decoration: BoxDecoration(
        border:
            Border(top: BorderSide(color: Theme.of(context).colorScheme.outlineVariant)),
      ),
      child: TextButton.icon(
        onPressed: () async {
          await notifier.clear();
          if (!mounted) return;
          setState(() => _expanded = null);
          Log.i('已清空本机通知历史', 'history');
        },
        icon: const Icon(Icons.delete_outline_rounded, size: 18),
        label: const Text('清空历史'),
      ),
    );
  }

  Widget _row(BuildContext context, NoticeRecord r, bool expanded) {
    final scheme = Theme.of(context).colorScheme;
    final urgent = r.isUrgent;
    final tint = urgent ? scheme.error : scheme.primary;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            onTap: () => setState(() => _expanded = expanded ? null : r.seq),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  urgent ? Icons.campaign_rounded : Icons.info_outline_rounded,
                  size: 18,
                  color: tint,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        r.title.isEmpty ? '集控通知' : r.title,
                        style: TextStyle(
                          fontWeight: FontWeight.w600,
                          color: tint,
                          fontSize: 13,
                        ),
                      ),
                      const SizedBox(height: 2),
                      // 一行摘要：正文可能很长，全塞进列表里就没法扫读
                      Text(
                        r.body.isEmpty ? '（无正文）' : r.body,
                        maxLines: expanded ? null : 1,
                        overflow:
                            expanded ? TextOverflow.visible : TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 12,
                          color: scheme.onSurface.withValues(alpha: 0.75),
                        ),
                      ),
                      const SizedBox(height: 3),
                      Row(
                        children: [
                          Text(
                            _hhmm(r.at),
                            style: TextStyle(
                                fontSize: 11,
                                color: scheme.onSurface.withValues(alpha: 0.5)),
                          ),
                          if (r.isUrgent)
                            Padding(
                              padding: const EdgeInsets.only(left: 8),
                              child: Text(
                                r.confirmed ? '已确认' : '未确认',
                                style: TextStyle(
                                  fontSize: 11,
                                  color: r.confirmed
                                      ? scheme.primary
                                      : scheme.error,
                                ),
                              ),
                            ),
                          if (r.reply.isNotEmpty)
                            Padding(
                              padding: const EdgeInsets.only(left: 8),
                              child: Text(
                                '已回复',
                                style: TextStyle(
                                    fontSize: 11, color: scheme.primary),
                              ),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          if (expanded && r.reply.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(left: 26, top: 8),
              child: Container(
                decoration: BoxDecoration(
                  color: scheme.primaryContainer.withValues(alpha: 0.5),
                  borderRadius: BorderRadius.circular(8),
                ),
                padding: const EdgeInsets.all(8),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(Icons.reply_rounded, size: 14),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        r.reply,
                        style: const TextStyle(fontSize: 12),
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }

  static String _hhmm(DateTime t) {
    String p(int v) => v.toString().padLeft(2, '0');
    return '${p(t.month)}-${p(t.day)} ${p(t.hour)}:${p(t.minute)}';
  }
}

class _Empty extends StatelessWidget {
  const _Empty();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.inbox_outlined,
                size: 40, color: Theme.of(context).colorScheme.outline),
            const SizedBox(height: 10),
            const Text(
              '还没有历史消息',
              style: TextStyle(fontSize: 13),
            ),
            const SizedBox(height: 4),
            Text(
              '收到的通知会留在这里，方便回头查',
              style: TextStyle(
                  fontSize: 12,
                  color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.6)),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}
