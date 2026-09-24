/// 集控通知弹窗 —— 「老师必须看得见」的那一层。
///
/// 为什么不用 Windows 气泡（`_noticeScript`）：气泡会闪一个黑色控制台窗口，
/// 几秒就消失、正文稍长看不全。学校的场景是**投影仪正开着、老师背对屏幕**，
/// 一条闪过的气泡等于没发。所以改成应用内的大字弹窗 + 把窗口从托盘叫回来。
///
/// 为什么不做成独立的置顶小窗口：那需要多窗口支持（desktop_multi_window），
/// 为一条通知引入第二个窗口循环，代价与收益不匹配。把主窗口叫到最前 + 置顶，
/// 视觉上就是"弹出来了"，且天然复用现有界面与日志。
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/device_agent.dart';
import '../../core/log.dart';
import '../../core/tray.dart';

class NoticePopup extends ConsumerStatefulWidget {
  const NoticePopup({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<NoticePopup> createState() => _NoticePopupState();
}

class _NoticePopupState extends ConsumerState<NoticePopup> {
  AgentNotice? _current;
  Timer? _autoClose;
  bool _started = false;

  /// 急件（集控下发）留久一点，本机确认类一闪即走
  static const _urgentMs = 15000;
  static const _plainMs = 6000;

  @override
  void initState() {
    super.initState();
    // 告诉引擎"界面接管弹窗了"，它就不会再去起 PowerShell 气泡（避免弹两次）
    WidgetsBinding.instance.addPostFrameCallback((_) => _bind());
  }

  void _bind() {
    if (_started || !mounted) return;
    _started = true;
    final agent = ref.read(deviceAgentProvider);
    agent.uiBound = true;
    agent.notice.addListener(_onNotice);
    Log.i('通知弹窗已挂载（集控通知将由应用内弹窗显示）', 'notice');
  }

  @override
  void dispose() {
    _autoClose?.cancel();
    try {
      final agent = ref.read(deviceAgentProvider);
      agent.notice.removeListener(_onNotice);
      agent.uiBound = false;
    } catch (_) {
      // 容器可能已释放（退出流程）→ 静默
    }
    super.dispose();
  }

  void _onNotice() {
    final n = ref.read(deviceAgentProvider).notice.value;
    if (n == null || !mounted) return;

    setState(() => _current = n);
    _autoClose?.cancel();

    // 急件：把窗口从托盘叫回来并临时置顶；非急件只唤起，不抢屏幕
    final shell = ref.read(shellProvider);
    if (n.urgent) {
      shell.showForNotice();
    } else {
      shell.showWindow();
    }

    _autoClose = Timer(
      Duration(milliseconds: n.urgent ? _urgentMs : _plainMs),
      _dismiss,
    );
    Log.i('弹窗显示：${n.title} / ${n.body}', 'notice');
  }

  void _dismiss() {
    _autoClose?.cancel();
    if (!mounted) return;
    setState(() => _current = null);
    ref.read(shellProvider).releaseNotice();
    // 清空值，让同样内容的第二条通知也能再次触发（ValueNotifier 判等会吞掉相同引用）
    ref.read(deviceAgentProvider).notice.value = null;
  }

  @override
  Widget build(BuildContext context) {
    final n = _current;
    return Stack(
      children: [
        widget.child,
        if (n != null)
          Positioned(
            top: 16,
            left: 0,
            right: 0,
            child: Center(child: _card(context, n)),
          ),
      ],
    );
  }

  Widget _card(BuildContext context, AgentNotice n) {
    final scheme = Theme.of(context).colorScheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    // 急件用醒目的暖色；本机确认类用中性色，避免"什么都像警报"
    final accent = n.urgent ? const Color(0xFFE8590C) : scheme.primary;
    final bg = dark ? const Color(0xFF241C17) : const Color(0xFFFFF6EF);

    return Semantics(
      liveRegion: true,
      label: '集控通知：${n.display}',
      child: Material(
        color: Colors.transparent,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560),
          child: Container(
            margin: const EdgeInsets.symmetric(horizontal: 16),
            decoration: BoxDecoration(
              color: bg,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: accent.withValues(alpha: 0.45), width: 1.5),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: dark ? 0.45 : 0.18),
                  blurRadius: 24,
                  offset: const Offset(0, 8),
                ),
              ],
            ),
            padding: const EdgeInsets.fromLTRB(20, 18, 14, 18),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: accent.withValues(alpha: 0.14),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(
                    n.urgent ? Icons.campaign_rounded : Icons.info_outline_rounded,
                    color: accent,
                    size: 26,
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        n.title.isEmpty ? '集控通知' : n.title,
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          letterSpacing: 0.5,
                          color: accent,
                        ),
                      ),
                      const SizedBox(height: 6),
                      // 正文是重点：字号拉到 20，投影上/隔远也能读
                      Text(
                        n.body.isEmpty ? n.title : n.body,
                        style: const TextStyle(
                          fontSize: 20,
                          height: 1.45,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: '知道了',
                  onPressed: _dismiss,
                  icon: const Icon(Icons.close_rounded, size: 20),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
