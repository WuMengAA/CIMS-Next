/// 星集控 · 独立历史消息窗口
///
/// 屏幕右侧一个**独立的悬浮窗口**展示通知历史（用户 2026-09-26 选定）：
///   · 独立于主窗口进程（`xingjikong.exe --history` 拉起）；
///   · 默认置顶（AlwaysOnTop），可随时取消置顶让出屏幕；
///   · 可拖拽（顶部把手）、可缩放、可关闭；
///   · 与主窗口同读 notice_history.json（磁盘文件），无需跨进程同步。
///
/// 为什么独立窗口而不是主窗口内抽屉：老师上课时主窗口收在托盘里,
/// 历史侧栏要常驻在屏幕边上一眼可见 — 只有独立置顶窗口能做到。
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:window_manager/window_manager.dart';

import '../../core/log.dart';
import '../../core/notice_history.dart';

/// 独立历史窗口入口：main 里 --history 分支调用。
Future<void> runHistoryWindow() async {
  final container = ProviderContainer();
  await container.read(noticeHistoryProvider.notifier).load();
  await windowManager.ensureInitialized();
  await windowManager.waitUntilReadyToShow(
    const WindowOptions(
      size: Size(340, 720),
      minimumSize: Size(260, 400),
      center: false,
      title: '历史消息',
      alwaysOnTop: true,
    ),
    () async {
      await windowManager.setAlwaysOnTop(true);
      // 屏幕右侧贴边（像 Windows 侧边栏小组件）：历史侧栏是「屏边常驻条」，
      // 贴右缘垂直居中，置顶显示 —— 老师上课时大屏/课表居中不受遮挡，
      // 但最近几条通知一直在屏幕右边可见。
      await windowManager.setAlignment(Alignment.centerRight);
      await windowManager.show();
    },
  );
  runApp(UncontrolledProviderScope(
    container: container,
    child: MaterialApp(
      title: '历史消息',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(useMaterial3: true, colorSchemeSeed: const Color(0xFF534AB7)),
      darkTheme: ThemeData(
          useMaterial3: true,
          colorSchemeSeed: const Color(0xFF534AB7),
          brightness: Brightness.dark),
      home: const HistoryWindowShell(),
    ),
  ));
}

/// 独立历史窗口外壳：可拖拽标题栏 + 内容区 + 底部置顶/清空。
class HistoryWindowShell extends StatelessWidget {
  const HistoryWindowShell({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Theme.of(context).colorScheme.surface,
      body: Column(
        children: [
          const _DragBar(),
          const Expanded(child: _HistoryListPane()),
          const _PinBar(),
        ],
      ),
    );
  }
}

/// 顶部拖动把手。
class _DragBar extends StatelessWidget {
  const _DragBar();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return GestureDetector(
      onPanUpdate: (d) => windowManager.startDragging(),
      child: Container(
        height: 36,
        color: scheme.primary.withValues(alpha: 0.08),
        child: Row(
          children: [
            const SizedBox(width: 12),
            Icon(Icons.history_rounded, size: 16, color: scheme.primary),
            const SizedBox(width: 6),
            Text('历史消息',
                style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: scheme.onSurface)),
            const Spacer(),
            IconButton(
              tooltip: '关闭',
              onPressed: () async {
                Log.i('关闭独立历史窗口', 'history');
                await windowManager.close();
              },
              icon: const Icon(Icons.close, size: 16),
              iconSize: 16,
              visualDensity: VisualDensity.compact,
            ),
            const SizedBox(width: 4),
          ],
        ),
      ),
    );
  }
}

/// 历史消息列表。
class _HistoryListPane extends ConsumerStatefulWidget {
  const _HistoryListPane();

  @override
  ConsumerState<_HistoryListPane> createState() => _HistoryListPaneState();
}

class _HistoryListPaneState extends ConsumerState<_HistoryListPane> {
  int? _expanded;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(noticeHistoryProvider.notifier).load();
    });
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final items = ref.watch(noticeHistoryProvider);
    if (items.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.inbox_outlined, size: 36, color: scheme.outline),
              const SizedBox(height: 8),
              const Text('还没有历史消息', style: TextStyle(fontSize: 13)),
              const SizedBox(height: 4),
              Text(
                '收到的通知会留在这里，方便回头查',
                style: TextStyle(
                    fontSize: 12,
                    color: scheme.onSurface.withValues(alpha: 0.6)),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.symmetric(vertical: 4),
      itemCount: items.length,
      separatorBuilder: (_, _) => const Divider(height: 1),
      itemBuilder: (context, i) {
        final r = items[i];
        final expanded = r.seq == _expanded;
        final urgent = r.isUrgent;
        final tint = urgent ? scheme.error : scheme.primary;
        return InkWell(
          onTap: () => setState(() => _expanded = expanded ? null : r.seq),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(
                      urgent ? Icons.campaign_rounded : Icons.info_outline_rounded,
                      size: 16,
                      color: tint,
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        r.title.isEmpty ? '集控通知' : r.title,
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: tint,
                        ),
                      ),
                    ),
                    if (!r.read)
                      Container(
                        width: 8,
                        height: 8,
                        decoration: BoxDecoration(
                          color: scheme.error,
                          shape: BoxShape.circle,
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  r.body.isEmpty ? '（无正文）' : r.body,
                  maxLines: expanded ? null : 2,
                  overflow: expanded ? TextOverflow.visible : TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 12,
                    color: scheme.onSurface.withValues(alpha: 0.75),
                  ),
                ),
                const SizedBox(height: 2),
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
                            color: r.confirmed ? scheme.primary : scheme.error,
                          ),
                        ),
                      ),
                    if (r.reply.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(left: 8),
                        child: Text(
                          '已回复',
                          style: TextStyle(fontSize: 11, color: scheme.primary),
                        ),
                      ),
                  ],
                ),
                if (expanded && r.reply.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Container(
                    decoration: BoxDecoration(
                      color: scheme.primaryContainer.withValues(alpha: 0.5),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    padding: const EdgeInsets.all(8),
                    child: Text(r.reply, style: const TextStyle(fontSize: 12)),
                  ),
                ],
              ],
            ),
          ),
        );
      },
    );
  }

  static String _hhmm(DateTime t) {
    String p(int v) => v.toString().padLeft(2, '0');
    final mm = p(t.month) + '-' + p(t.day);
    final hh = p(t.hour) + ':' + p(t.minute);
    return mm + ' ' + hh;
  }
}

/// 底部：置顶开关 + 清空历史。
class _PinBar extends ConsumerWidget {
  const _PinBar();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      decoration: BoxDecoration(
        border: Border(
            top: BorderSide(color: scheme.outlineVariant.withValues(alpha: 0.5))),
      ),
      child: Row(
        children: [
          ValueListenableBuilder<bool>(
            valueListenable: WindowVisiblePinned,
            builder: (_, pinned, _) => TextButton.icon(
              onPressed: () async {
                final next = !pinned;
                WindowVisiblePinned.value = next;
                await windowManager.setAlwaysOnTop(next);
                Log.i('置顶：' + next.toString(), 'history');
              },
              icon: Icon(pinned ? Icons.push_pin : Icons.push_pin_outlined, size: 14),
              label: Text(pinned ? '已置顶' : '置顶'),
              style: TextButton.styleFrom(visualDensity: VisualDensity.compact),
            ),
          ),
          const Spacer(),
          TextButton.icon(
            onPressed: () async {
              final r = await showDialog<bool>(
                context: context,
                builder: (c) => AlertDialog(
                  title: const Text('清空历史？'),
                  content: const Text('将删除本机全部通知历史。'),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(c, false),
                        child: const Text('取消')),
                    FilledButton(
                        onPressed: () => Navigator.pop(c, true),
                        child: const Text('清空')),
                  ],
                ),
              );
              if (r == true) {
                await ref.read(noticeHistoryProvider.notifier).clear();
                Log.i('清空历史', 'history');
              }
            },
            icon: const Icon(Icons.delete_outline_rounded, size: 14),
            label: const Text('清空'),
            style: TextButton.styleFrom(visualDensity: VisualDensity.compact),
          ),
          const SizedBox(width: 6),
        ],
      ),
    );
  }
}

/// 独立窗口置顶状态。
final ValueNotifier<bool> WindowVisiblePinned = ValueNotifier(true);

