/// 集控通知呈现层 —— 「老师必须看得见」的那一层。
///
/// 为什么不用 Windows 气泡：会闪一个黑色控制台窗口、几秒就消失、正文稍长看不全。
/// 学校的场景是**投影仪正开着、老师背对屏幕**，一条闪过的气泡等于没发。
///
/// 这一层按通知类型分四种呈现，全部由 `AgentNotice.kind` 决定：
///   · `fullscreen` 真·全屏遮罩 —— 覆盖整块屏幕 + 窗口置顶，必须手动点「我知道了」；
///   · `popup`      弹窗卡 —— 高优先级，可「确认收到」，可点预设回复/自定义回复；
///   · `island`     岛内普通通知 —— 非打断横幅，滚动过即视为已读；
///   · `plain`      本机确认（已截图/已收文件）—— 只挂横幅，不抢屏幕。
///
/// ⚠️ 每条通知都会**写进本机历史**（[NoticeHistory]）：通知是一次性的，
/// 老师想回头查"刚才那条几点交"时，界面里已经没了。
library;

import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:window_manager/window_manager.dart';

import '../../core/device_agent.dart';
import '../../core/log.dart';
import '../../core/notice_history.dart';
import '../../core/tts.dart';
import '../../core/tray.dart';

import 'notice_history_drawer.dart';

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

  /// 当前是否处于「真全屏」状态（恢复窗口状态时要还原）
  bool _fsOn = false;

  /// 弹窗里老师正在输入的自定义回复
  final TextEditingController _reply = TextEditingController();
  bool _replying = false;
  String _replyHint = '';

  /// 急件（集控下发）留久一点；island 只是过一眼
  static const _urgentMs = 20000;
  static const _plainMs = 6000;

  @override
  void initState() {
    super.initState();
    // 告诉引擎"界面接管弹窗了"，它就不会再去起 PowerShell 气泡（避免弹两次）
    WidgetsBinding.instance.addPostFrameCallback((_) => _bind());
  }

  @override
  void dispose() {
    _autoClose?.cancel();
    _reply.dispose();
    // 全屏状态下退出 → 必须还原窗口，否则软件退出后留下一个黑屏满屏的残留窗口
    if (_fsOn) unawaited(_exitFullscreen());
    try {
      final agent = ref.read(deviceAgentProvider);
      agent.notice.removeListener(_onNotice);
      agent.uiBound = false;
    } catch (_) {
      // 容器可能已释放（退出流程）→ 静默
    }
    super.dispose();
  }

  void _bind() {
    if (_started || !mounted) return;
    _started = true;
    final agent = ref.read(deviceAgentProvider);
    agent.uiBound = true;
    agent.notice.addListener(_onNotice);
    // 历史：启动时从磁盘载入一次（首次运行 = 空列表）
    unawaited(ref.read(noticeHistoryProvider.notifier).load());
    Log.i('通知弹窗已挂载（集控通知将由应用内弹窗显示）', 'notice');
  }

  void _onNotice() {
    final n = ref.read(deviceAgentProvider).notice.value;
    if (n == null || !mounted) return;

    // 上一条还是全屏 → 先撤掉全屏再显示新的，否则两条叠在一起
    if (_fsOn) _exitFullscreen();

    setState(() {
      _current = n;
      _replyHint = '';
      _replying = false;
    });
    _autoClose?.cancel();

    final shell = ref.read(shellProvider);
    if (n.kind == 'fullscreen' || n.kind == 'popup') {
      shell.showForNotice();
      _enterFullscreenIfNeeded();
    } else {
      shell.showWindow();
    }

    _record(n);
    if (n.tts) unawaited(speak(n.display, logTag: 'notice'));

    _autoClose = Timer(Duration(milliseconds: _autoCloseMs(n)), _dismiss);
    Log.i(
        '弹窗显示：${n.display}（kind=${n.kind}${n.noticeId > 0 ? ' #${n.noticeId}' : ''}）',
        'notice');
  }

  int _autoCloseMs(AgentNotice n) {
    if (n.kind == 'fullscreen') {
      // 全屏遮罩由老师手动关；服务端显式给了 auto_dismiss_seconds 才自动关。
      return n.autoDismissSeconds > 0 ? n.autoDismissSeconds * 1000 : 0;
    }
    if (n.kind == 'popup') return _urgentMs;
    return n.urgent ? _urgentMs : _plainMs;
  }

  void _record(AgentNotice n) {
    final seq = n.noticeId > 0 ? n.noticeId : _seqOf(n);
    ref.read(noticeHistoryProvider.notifier).add(NoticeRecord(
          seq: seq,
          kind: n.kind,
          title: n.title,
          body: n.body,
          at: n.at,
        ));
  }

  /// 本机通知（noticeId=0）也给一个本地 seq，历史里才认得出、也不会互相覆盖。
  int _seqOf(AgentNotice n) {
    if (n.noticeId > 0) return n.noticeId;
    return 900000000 + n.at.microsecondsSinceEpoch % 99999999;
  }

  // ---- 全屏 ----

  Future<void> _enterFullscreenIfNeeded() async {
    final n = _current;
    if (n == null || n.kind != 'fullscreen') return;
    if (!Platform.isWindows) return;
    try {
      await windowManager.setFullScreen(true);
      await windowManager.setAlwaysOnTop(true);
      _fsOn = true;
    } catch (e) {
      Log.w('全屏遮罩未能进入全屏（仍以置顶卡呈现）：$e', 'notice');
    }
  }

  Future<void> _exitFullscreen() async {
    if (!Platform.isWindows) return;
    try {
      await windowManager.setFullScreen(false);
    } catch (_) {}
    try {
      await windowManager.setAlwaysOnTop(false);
    } catch (_) {}
    _fsOn = false;
  }

  // ---- 确认 / 回复 ----

  Future<void> _confirm() async {
    final n = _current;
    if (n == null) return;
    _autoClose?.cancel();
    setState(() => _replying = true);
    try {
      if (n.noticeId > 0) {
        await ref.read(deviceAgentProvider).confirmNotice(n.noticeId);
        ref.read(noticeHistoryProvider.notifier).markConfirmed(n.noticeId);
      }
    } finally {
      if (mounted) setState(() => _replying = false);
    }
    await _close();
  }

  Future<void> _submitReply(String text) async {
    final n = _current;
    if (n == null) return;
    final body = text.trim();
    if (body.isEmpty) {
      setState(() => _replyHint = '回复内容不能为空');
      return;
    }
    setState(() => _replying = true);
    final ok = await ref.read(deviceAgentProvider).replyNotice(n.noticeId, body);
    if (!mounted) return;
    setState(() {
      _replying = false;
      _replyHint = ok ? '已回复操控端' : '回复没发出去（本机未配置设备密钥或网络不通）';
    });
    if (ok) {
      ref.read(noticeHistoryProvider.notifier).setReply(n.noticeId, body);
    }
    Log.i(ok ? '回复已上报' : '回复未上报', 'notice');
  }

  Future<void> _dismiss() {
    // 自动关闭也算"看到了"：老师没点在屏幕上，但通知确实亮过。
    // 只有 popup 的「确认收到」才算 confirmed —— 自动消失不该冒充人确认过。
    final n = _current;
    if (n != null && n.kind == 'popup' && n.noticeId > 0) {
      ref.read(noticeHistoryProvider.notifier).markConfirmed(n.noticeId);
    }
    return _close();
  }

  Future<void> _close() async {
    _autoClose?.cancel();
    final n = _current;
    if (n != null && n.noticeId > 0) {
      await ref.read(deviceAgentProvider).confirmNotice(n.noticeId);
    }
    if (_fsOn) await _exitFullscreen();
    if (!mounted) return;
    setState(() => _current = null);
    try {
      await ref.read(shellProvider).releaseNotice();
    } catch (_) {}
    // 清空值，让同样内容的第二条通知也能再次触发
    try {
      ref.read(deviceAgentProvider).notice.value = null;
    } catch (_) {}
  }

  // ---- 渲染 ----

  @override
  Widget build(BuildContext context) {
    final n = _current;
    return Stack(
      children: [
        widget.child,
        const NoticeHistoryDrawer(),
        if (n != null)
          n.kind == 'fullscreen'
              ? _fullscreen(context, n)
              : Positioned(
                  top: 16,
                  left: 0,
                  right: 0,
                  child: Center(child: _card(context, n)),
                ),
      ],
    );
  }

  /// 真·全屏遮罩：铺满整块屏幕，老师不点「我知道了」就一直在。
  Widget _fullscreen(BuildContext context, AgentNotice n) {
    final scheme = Theme.of(context).colorScheme;
    final bg = Theme.of(context).brightness == Brightness.dark
        ? const Color(0xFF12060A)
        : const Color(0xFF2B0A0A);
    return Positioned.fill(
      child: Semantics(
        liveRegion: true,
        label: '紧急通知：${n.display}',
        child: ColoredBox(
          color: bg,
          child: SafeArea(
            child: LayoutBuilder(builder: (context, box) {
              // 窄屏（投影/竖屏）时上下排，宽屏左右排，保证永远读得全
              final wide = box.maxWidth > 720;
              return Center(
                child: SingleChildScrollView(
                  child: ConstrainedBox(
                    constraints: BoxConstraints(maxWidth: wide ? 900 : box.maxWidth - 48),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment:
                          wide ? CrossAxisAlignment.start : CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          children: [
                            const Icon(Icons.warning_rounded,
                                color: Color(0xFFFFB020), size: 30),
                            const SizedBox(width: 12),
                            Text(
                              n.title.isEmpty ? '紧急通知' : n.title,
                              style: const TextStyle(
                                fontSize: 22,
                                fontWeight: FontWeight.w800,
                                color: Color(0xFFFFB020),
                                letterSpacing: 1,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 22),
                        Text(
                          n.body.isEmpty ? n.title : n.body,
                          style: const TextStyle(
                            fontSize: 30,
                            height: 1.45,
                            fontWeight: FontWeight.w700,
                            color: Colors.white,
                          ),
                        ),
                        const SizedBox(height: 14),
                        Text(
                          '来自集控 · ${n.at.toString().substring(0, 19)}',
                          style: TextStyle(
                              fontSize: 13,
                              color: Colors.white.withValues(alpha: 0.6)),
                        ),
                        const SizedBox(height: 36),
                        _actions(n, scheme, wide: wide, big: true),
                      ],
                    ),
                  ),
                ),
              );
            }),
          ),
        ),
      ),
    );
  }

  /// 通知上的操作区：确认 + 回复。全屏时按钮加大一圈（远处也要点得到）。
  ///
  /// 🚨 「确认收到」和「我知道了」只保留**一个**（需要确认时前者、否则后者）。
  /// 两个动作一样、两个按钮并存时，老师会犹豫点哪个，犹豫的那几秒
  /// 恰好就是这条通知最需要被看见的时间。
  Widget _actions(AgentNotice n, ColorScheme scheme,
      {bool wide = true, bool big = false}) {
    // 必须是 double：TextStyle.fontSize 是 double?，int 传不进去（分析器会报）
    final double fontSize = big ? 18 : 13;
    final btn = big
        ? const EdgeInsets.symmetric(horizontal: 30, vertical: 16)
        : const EdgeInsets.symmetric(horizontal: 16, vertical: 10);
    return Column(
      crossAxisAlignment: wide ? CrossAxisAlignment.start : CrossAxisAlignment.stretch,
      children: [
        Wrap(
          spacing: 10,
          runSpacing: 10,
          children: [
            FilledButton(
              onPressed: _busy ? null : _confirm,
              style: FilledButton.styleFrom(
                padding: btn,
                textStyle: TextStyle(fontSize: fontSize),
              ),
              child: Text(n.requiresConfirm ? '确认收到' : '我知道了'),
            ),
            OutlinedButton.icon(
              onPressed: _busy ? null : () => noticeDrawerOpen.value = true,
              style: OutlinedButton.styleFrom(
                padding: btn,
                textStyle: TextStyle(fontSize: fontSize),
              ),
              icon: const Icon(Icons.history_rounded, size: 18),
              label: const Text('查看历史'),
            ),
          ],
        ),
        if (n.replyable) ...[
          const SizedBox(height: 14),
          Text(
            '回复操控端：',
            style: TextStyle(fontSize: fontSize, color: scheme.onSurfaceVariant),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final p in n.presets)
                ActionChip(
                  label: Text(p, style: TextStyle(fontSize: fontSize)),
                  onPressed: _replying ? null : () => _submitReply(p),
                ),
              ActionChip(
                label: const Text('（自定义…）'),
                onPressed: _replying
                    ? null
                    : () => setState(() => _replying = true),
              ),
            ],
          ),
          if (_replying) ...[
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _reply,
                    maxLines: 3,
                    maxLength: 500,
                    onSubmitted: _replying ? _submitReply : null,
                    decoration: const InputDecoration(
                      hintText: '输入回复内容…',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton.tonal(
                  onPressed: _replying || _reply.text.trim().isEmpty
                      ? null
                      : () => _submitReply(_reply.text),
                  child: const Text('发送'),
                ),
              ],
            ),
          ],
          if (_replyHint.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                _replyHint,
                style: TextStyle(
                    fontSize: 12,
                    color: _replyHint.startsWith('已')
                        ? scheme.primary
                        : scheme.error),
              ),
            ),
        ],
      ],
    );
  }

  /// 确认/回复在跑（网络往返）——期间禁用按钮，避免老师连点触发重复回执。
  /// 用独立的忙标记，而不是复用 [_replying]（那会连带把"确认"也一起禁掉）。
  bool get _busy => _replying;

  Widget _card(BuildContext context, AgentNotice n) {
    final scheme = Theme.of(context).colorScheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    // 集控急件用醒目的暖色；本机确认类用中性色，避免"什么都像警报"
    final accent = n.urgent || n.kind == 'popup' || n.kind == 'fullscreen'
        ? const Color(0xFFE8590C)
        : scheme.primary;
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
                    n.kind == 'popup' ? Icons.mail_outline_rounded
                    : n.urgent ? Icons.campaign_rounded
                    : Icons.info_outline_rounded,
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
                      const SizedBox(height: 12),
                      _actions(n, scheme, big: false),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: '关闭',
                  onPressed: _busy ? null : _dismiss,
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
